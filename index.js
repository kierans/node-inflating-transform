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
 * @yields {InflatedData<B>|Promise<InflatedData<B>>} Data to be pushed to the Readable buffer
 */

/**
 * @template {any} B The output chunk type
 *
 * @function BurstingGenerator
 * @generator
 * @yields {InflatedData<B>|Promise<InflatedData<B>>|null} Data to be pushed to the Readable buffer. Should yield `null` to indicate that the stream is finished.
 */

/**
 * @typedef {Object} InflatingTransformOptions
 * @extends TransformOptions
 * @property {InflatingGenerator} [inflate] The generator to use to process chunks written to the stream.
 * @property {BurstingGenerator} [burst] The generator to use to when the stream is flushed.
 */

/**
 * @typedef {Function} NextFunction A function which indicates what to do next when trampolining
 * @returns {NextFunction|null}
 */

/**
 * A Transform is a Duplex stream, in that it is Readable and Writable. It therefore has two
 * buffers, a write buffer and a read buffer. The write buffer holds data from calls to `write`
 * and the read buffer holds data that is to be consumed by calls to `read`. Data from the
 * write buffer is given to the `_transform` method of the Transform stream. Implementations of
 * `_transform` have to [add output to the read buffer][3] via calls to `push`. `_transform`
 * signals when a chunk of data from the Writable buffer is processed by using the `callback`
 * argument.
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
 * To accommodate generators that need to perform asynchronous work to transform a chunk,
 * generator methods in this class can yield Promises, or an async generator can be used.
 * The class will wait for the Promise to resolve before pushing the value. If the Promise
 * rejects, the error will be passed to the transform callback function.
 *
 * Subclasses can override the `_transform` implementation if necessary. However, if `push`
 * returns false, subclasses should wait for the `ready` event before pushing more data. They
 * should defer calling the callback passed to the `_transform` method until after they have
 * pushed everything they can so far.
 *
 * To accommodate streams that need to push final chunks of data when flushed, the class
 * provides a default implementation of `_flush`. The method will use a generator method
 * `*_burst` to generate additional chunks of data to be pushed to the Readable stream.
 * The default implementation of `*_burst` simply yields `null`. Subclasses may override
 * `*_burst`, or provide it via the constructor option `burst`.
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

		if (opts.burst) {
			this._burst = opts.burst
		}
	}

	/**
	 * @override
	 */
	_transform(chunk, encoding, callback) {
		this._push(() => this._inflate(chunk, encoding), callback)
	}

	/**
	 * @override
	 */
	_flush(callback) {
		this._push(() => this._burst(), callback)
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
		 * superclass `_read` method. Which will do nothing if the stream is still paused. This
		 * may intentionally happen multiple times if the transform inflates the data to the
		 * extent that the read buffer is filled multiple times before the Writable needs to
		 * resume. However, if the superclass isn't called **after** the `_transform` callback
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
	 * @yields {InflatedData<B>|Promise<InflatedData<B>>} A chunk of data
	 */
	// noinspection JSUnusedLocalSymbols
	*_inflate(chunk, encoding) {
		throw new Error("Unimplemented")
	}

	/**
	 * Generator method that is called when the Transform stream is flushed.
	 *
	 * By default, yields null.
	 *
	 * @yields {InflatedData<B>|Promise<InflatedData<B>>|null} A chunk of data
	 */
	*_burst() {
		yield null
	}

	/**
	 * Pushes values from a generator to the Readable stream.
	 *
	 * Handles any errors thrown when creating a generator.
	 *
	 * @param {() => Generator<A, InflatedData<B>|Promise<InflatedData<B>>|AsyncGenerator<A, InflatedData<B>>|null>} factory Creates a generator
	 * @param {TransformCallback} callback
	 * @private
	 */
	_push(factory, callback) {
		let generator;

		try {
			// we only want to catch errors thrown when creating the generator
			generator = factory();
		}
		catch (e) {
			return callback(e)
		}

		this._resumePushing(() => this._pushNextValue(generator, callback))
	}

	/**
	 * Resumes pushing from a continuation.
	 *
	 * Continuations are used to encapsulate execution state about what to "do next" as data is
	 * pushed through the stream. This allows synchronous and asynchronous work
	 * (both with promises and events) to be done by the stream as the "next step" for pushing a
	 * chunk of data is encapsulated into a function and executed when required. Being a
	 * function, the execution state can be passed to and returned from other functions (methods).
	 *
	 * Uses trampolining to avoid stack overflow with continuations.
	 *
	 * @see https://en.wikipedia.org/wiki/Continuation
	 * @param {NextFunction} next What to do next
	 * @return null If method is used in a continuation, signal no more work to be done.
	 * @private
	 */
	_resumePushing(next) {
		return trampoline(next)
	}

	/**
	 * Invokes the generator and pushes the result.
	 *
	 * Handles any errors thrown when the generator yields a value.
	 *
	 * @param {Generator<A, InflatedData<B>|Promise<InflatedData<B>>|AsyncGenerator<A, InflatedData<B>>|null>} generator
	 * @param {TransformCallback} callback
	 * @return {NextFunction|null} Returns a function for what to do next, or null if nothing is to be done.
	 * @private
	 */
	_pushNextValue(generator, callback) {
		// next :: InflatedData<B> -> NextFunction|null
		const next = (value) => this._pushYieldedValue(value, generator, callback);

		// promiseToPush :: Promise<IteratorResult<InflatedData<B>>> -> null
		const promiseToPush = (promise) =>
			voidToNull(() =>
				promise
				.then(next)
				.then((next) => this._resumePushing(next))
				.catch(callback)
			)

		try {
			const result = generator.next();

			// if the generator is an AsyncGenerator<B>, the result will be a Promise<IteratorResult<B>>
			if (isPromiseLike(result)) {
				return promiseToPush(result);
			}

			// if the generator is a Generator<Promise<B>>, the result will be a IteratorResult<Promise<B>>
			if (isPromiseLike(result.value)) {
				return promiseToPush(result.value.then(toIteratorResult(result.done)));
			}

			return next(result);
		}
		catch (e) {
			return voidToNull(() => callback(e))
		}
	}

	/**
	 * Handles the logic of pushing a yielded value from a generator.
	 *
	 * @param {IteratorResult<InflatedData<B>>} value
	 * @param {Generator<A, InflatedData<B>|Promise<InflatedData<B>>|AsyncGenerator<A, InflatedData<B>>|null>} generator
	 * @param {TransformCallback} callback
	 * @return {NextFunction|null} Returns a function for what to do next, or null if nothing is to be done.
	 */
	_pushYieldedValue(value, generator, callback) {
		const done = voidToNull(callback);
		const next = () => this._pushNextValue(generator, callback)

		if (value.done) {
			return done;
		}

		const bufferStatus = this._pushInflatedData(value.value);

		if (isFull(bufferStatus)) {
			this.once("ready", () => this._resumePushing(next));

			// Nothing to do while waiting for a 'ready' event
			return null;
		}

		if (isNotFull(bufferStatus)) {
			// continue pushing
			return next;
		}

		// we need to stop pushing as the stream is finished
		return done;
	}

	/**
	 * Pushes a single value to the Readable stream.
	 *
	 * @param {InflatedData<B>|null} data
	 * @returns {ReadableBufferStatus}
	 * @private
	 */
	_pushInflatedData(data) {
		if (data === null) {
			this.push(null);

			return ReadableBufferStatus.FINISHED
		}
		else {
			const more = this.push(data.chunk, data.encoding);

			return more ? ReadableBufferStatus.NOT_FULL : ReadableBufferStatus.FULL
		}
	}
}

/**
 * Trampoline executor that runs a function until next returns a non-function value.
 *
 * This is because v8 doesn't support TCO.
 *
 * @param {NextFunction|null} next What to do next
 * @return null Signal no more work to be done
 * @private
 */
const trampoline = (next) => {
	while (typeof next === "function") {
		next = next()
	}

	return null;
}

/**
 * Represents the status of the Readable stream buffer.
 *
 * @enum {string}
 * @private
 * @readonly
 */
const ReadableBufferStatus = {
	NOT_FULL: "NOT_FULL",
	FULL: "FULL",
	FINISHED: "FINISHED"
}

// isFull :: ReadableBufferStatus -> Boolean
const isFull = (status) => status === ReadableBufferStatus.FULL

// isNotFull :: ReadableBufferStatus -> Boolean
const isNotFull = (status) => status === ReadableBufferStatus.NOT_FULL

// isPromiseLike :: a -> Boolean
const isPromiseLike = (a) =>
	a !== null && typeof a === "object" && typeof a.then === "function";

// toIteratorResult :: Boolean -> a -> IteratorResult a
const toIteratorResult = (done) => (value) => ({
	done,
	value
})

// voidToNull :: (() -> void) -> () -> null
const voidToNull = (fn) => () => {
	fn();

	return null;
}

module.exports = InflatingTransform
