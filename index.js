const { Transform } = require("node:stream")

/**
 * @template {any} T
 *
 * @typedef {Object} InflatedData<T>
 * @property {T} chunk - The chunk to push to the Readable stream buffer
 * @property {BufferEncoding|undefined} encoding If the chunk is a string, then this is the encoding type. If chunk is a buffer, then this is the special value `'buffer'`. Else undefined
 */

/**
 * @template {any} A The input chunk type
 * @template {any} B The output chunk type
 *
 * @function InflatingGenerator
 * @generator
 * @param {A} chunk A chunk of data written to the stream
 * @param {BufferEncoding|undefined} encoding If the chunk is a string, then this is the encoding type. If chunk is a buffer, then this is the special value `'buffer'`. Else undefined
 * @yields {InflatedData<B>} Data to be pushed to the Readable buffer
 */

/**
 * @typedef {Object} InflatingTransformOptions
 * @extends TransformOptions
 * @property {InflatingGenerator} [inflate] The generator to use to process chunks written to the stream.
 */

/**
 * A Transform is a Duplex stream, in that it is Readable and Writable. It therefore has two
 * buffers, a write buffer and a read buffer. The write buffer holds data from calls to `write`
 * and the read buffer holds data that is to be consumed by calls to `read`. Data from the
 * write buffer is given to the `_transform` method of the Transform stream. Implementations of
 * `_transform` have to [add output to the read buffer][3] via calls to `push`.
 *
 * A common scenario can occur when a Transform is outputting more data than it is receiving
 * into the transformation process. For example, when unzipping or inflating compressed data,
 * the output from the stream is larger than the input. In this scenario, it is not uncommon
 * to fill the read buffer faster than it can be consumed.
 *
 * The Writable stream has a mechanism for signalling when it is full, and producers have to
 * pause. When the write buffer is full, `write` will return false, and the client
 * needs to wait for the `drain` event before writing more data.
 *
 * When adding data to the Readable read buffer, the `push` method is used. However, if the
 * consumer of the Readable is slower than the transform is pushing data (for example, printing
 * to stdout), `push` will return false, indicating the transform needs to wait before pushing
 * more. But how is it to know when it can continue? Turns out there isn't an event for that.
 *
 * By reading the docs on [push][1] and [_read][2] we can see that when a consumer is wanting
 * to read more data from the Readable, but the read buffer has been exhausted, `_read` will
 * be called. Therefore, we can emulate for Readables what the `drain` event does for Writables
 * by emitting a `ready` event when `_read` is called. An `InflatingTransform` does this, to
 * allow the transform logic to continue, before calling the Transform (superclass) `_read`
 * method. The superclass method, if the transform logic has completed what it has received so
 * far (indicated via the callback provided to `_transform`), will arrange for another call to
 * `_transform`.
 *
 * The class provides a default implementation of `_transform` which will use a generator method
 * `*_inflate` to generate chunks of data to be pushed from a chunk that is written to the stream.
 * Subclasses must override `*_inflate`, or provide it via the constructor option `inflate`.
 *
 * Subclasses can override the `_transform` implementation if necessary. However if `push`
 * returns false, subclasses should wait for the `ready` event before pushing more data. They
 * should defer calling the callback passed to the `_transform` method until after they have
 * pushed everything they can so far.
 *
 * [1]: https://nodejs.org/docs/latest-v18.x/api/stream.html#readablepushchunk-encoding
 * [2]: https://nodejs.org/docs/latest-v18.x/api/stream.html#readable_readsize
 * [3]: https://nodejs.org/docs/latest-v18.x/api/stream.html#transform_transformchunk-encoding-callback
 *
 * @template {any} A The input chunk type
 * @template {any} B The output chunk type
 */
class InflatingTransform extends Transform {
	/**
	 * @param {InflatingTransformOptions} opts
	 */
	constructor(opts) {
		super(opts)

		if (opts.inflate) {
			this._inflate = opts.inflate
		}
	}

	/**
	 * @override
	 */
	_transform(chunk, encoding, callback) {
		try {
			this._push(this._inflate(chunk, encoding), callback)
		}
		catch (e) {
			callback(e)
		}
	}

	/**
	 * @override
	 */
	_read(size) {
		/*
		 * As data is transformed, it queues up in the Readable stream buffer. But once the buffer
		 * is full, the Transform should delay calling the callback provided to `_transform`, so
		 * no more data should flow in: the Writable side of the stream is therefore paused (as
		 * long as the upstream producer honours the semantics of the `write` return value, etc.).
		 *
		 * When the downstream consumer reads transformed data, it pulls off the Readable stream's
		 * buffer, and when it runs out, it calls `_read` to get more data. However, when `_read`
		 * is called here in `InflatingTransform`, the Transform is paused because the buffer was
		 * full. But now the Readable buffer is empty.
		 *
		 * Therefore, we have to emit the `ready` event **first** to allow the Transform stream to
		 * resume and starting pushing data into the Readable stream buffer before calling the
		 * superclass `_read` method, which will do nothing if the stream is still paused. This
		 * may intentionally happen multiple times if the transform inflates the data to the
		 * extent that the read buffer is filled multiple times before the Writable needs to
		 * resume, however, if the superclass isn't called **after** the `_transform` callback
		 * has been called, the Writable effectively won't resume at all.
		 */
		this.emit("ready")

		super._read(size)
	}

	/**
	 * Generator method to create data from a chunk.
	 *
	 * The default implementation throws an Error.
	 *
	 * @param {A} chunk - The chunk to process
	 * @param encoding {BufferEncoding|undefined} If the chunk is a string, then this is the encoding type. If chunk is a buffer, then this is the special value `'buffer'`. Else undefined
	 * @yields {InflatedData<B>} A chunk of data
	 */
	*_inflate(chunk, encoding) {
		throw new Error("Unimplemented")
	}

	/**
	 * Pushes values from a generator to the Readable stream.
	 *
	 * `_push` obeys the rules of backpressure, in that, if the Readable buffer is full, `_push`
	 * will wait for a `ready` event before continuing.
	 *
	 * @param {Generator<B>} generator
	 * @param {TransformCallback} callback
	 * @private
	 */
	_push(generator, callback) {
		try {
			let next, more = true;
			do {
				next = generator.next()

				if (next.value !== undefined) {
					more = this.push(next.value.chunk, next.value.encoding)
				}
			}
			while (!next.done && more)

			if (!more) {
				this.once("ready", () => this._push(generator, callback))

				return
			}

			callback()
		}
		catch (e) {
			callback(e)
		}
	}
}

module.exports = InflatingTransform
