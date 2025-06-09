const { Transform } = require("node:stream")

/*
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
 * Subclasses, if `push` returns false, should wait for the `ready` event before pushing more
 * data. They should defer calling the callback passed to the `_transform` method until after
 * they have pushed everything they can so far.
 *
 * [1]: https://nodejs.org/docs/latest-v18.x/api/stream.html#readablepushchunk-encoding
 * [2]: https://nodejs.org/docs/latest-v18.x/api/stream.html#readable_readsize
 * [3]: https://nodejs.org/docs/latest-v18.x/api/stream.html#transform_transformchunk-encoding-callback
 */
class InflatingTransform extends Transform {
	constructor(opts) {
		super(opts)
	}

	_read(size) {
		/*
		 * When untransformed data is written into the Writable stream, it is transformed straight
		 * away, queuing up the transformed data in the Readable stream buffer. But once the buffer
		 * is full, the Transform should delay calling the callback provided by the upstream producer
		 * (this is the `callback` argument to `_transform`). So no more data will flow in. The
		 * Writable side of the stream is therefore effectively paused.
     *
		 * When the downstream consumer reads transformed data, it pulls off the Readable streams
		 * buffer, and when it runs out, it calls `_read` to get more data. However, when `_read`
		 * is called here in `InflatingTransform`, the Transform is paused because the buffer was
		 * full. But now the Readable buffer is empty.
		 *
		 * Therefore, we have to emit the `ready` event **first** to allow the Transform stream to
		 * resume and starting pushing data into the Readable stream buffer before calling the
		 * superclass `_read` method. Otherwise, the consumer will have nothing to read.
		 */
		this.emit("ready")

		super._read(size)
	}
}

module.exports = InflatingTransform
