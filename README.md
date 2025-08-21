# inflating-transform

A Node.js [Transform stream][4] that handles streaming large volumes of data produced from input
to the stream. Includes TypeScript type definitions.

A Transform is a Duplex stream, in that it is Readable and Writable. It therefore has two
buffers, a write buffer and a read buffer. The write buffer holds data from calls to `write`
and the read buffer holds data that is to be consumed by calls to `read`. Data from the
write buffer is given to the `_transform` method of the Transform stream. Implementations of
`_transform` have to [add output to the read buffer][3] via calls to `push`. `_transform` 
signals when a chunk of data from the Writable buffer is processed by using the `callback` 
argument.

A common scenario can occur when a Transform is outputting more data than it is receiving
into the transformation process. For example, when unzipping or inflating compressed data,
the output from the stream is larger than the input. In this scenario, it is not uncommon
to fill the read buffer faster than it can be consumed.

The Writable stream has a mechanism for signalling when it is full, and producers have to
pause. When the write buffer is full, `write` will return false, and the client
needs to wait for the `drain` event before writing more data.

When adding data to the Readable read buffer, the `push` method is used. However, if the
consumer of the Readable is slower than the transform is pushing data (for example, printing
to stdout), `push` will return false, indicating the transform needs to wait before pushing
more. But how is it to know when it can continue? Turns out there isn't an event for that.

By reading the docs on [push][1] and [_read][2] we can see that when a consumer is wanting
to read more data from the Readable, but the read buffer has been exhausted, `_read` will
be called. Therefore, we can emulate for Readables what the `drain` event does for Writables
by emitting a `ready` event when `_read` is called. An `InflatingTransform` does this, to
allow the transform logic to continue, before calling the Transform (superclass) `_read`
method. The superclass method, if the transform logic has completed what it has received so
far (indicated via the callback provided to `_transform`), will arrange for another call to
`_transform`.

The class provides a default implementation of `_transform` which will use a generator method
`*_inflate` to generate chunks of data to be pushed from a chunk that is written to the stream.
Subclasses must override `*_inflate`, or provide it via the constructor option `inflate`.

To accommodate generators that need to perform asynchronous work to transform a chunk,
generator methods in this class can yield Promises, or an async generator can be used.
The class will wait for the Promise to resolve before pushing the value. If the Promise
rejects, the error will be passed to the transform callback function.

Subclasses can override the `_transform` implementation if necessary. However, if `push`
returns false, subclasses should wait for the `ready` event before pushing more data. They
should defer calling the callback passed to the `_transform` method until after they have
pushed everything they can so far.

To accommodate streams that need to push final chunks of data when flushed, the class
provides a default implementation of `_flush`. The method will use a generator method
`*_burst` to generate additional chunks of data to be pushed to the Readable stream.
The default implementation of `*_burst` simply yields `null`. Subclasses may override
`*_burst`, or provide it via the constructor option `burst`.

Read more at https://medium.com/@kierans777/youve-been-using-node-js-transform-streams-wrong-064274823a27

[1]: https://nodejs.org/docs/latest-v18.x/api/stream.html#readablepushchunk-encoding
[2]: https://nodejs.org/docs/latest-v18.x/api/stream.html#readable_readsize
[3]: https://nodejs.org/docs/latest-v18.x/api/stream.html#transform_transformchunk-encoding-callback
[4]: https://nodejs.org/docs/latest-v18.x/api/stream.html#class-streamtransform

## Usage

```shell
$ npm install inflating-transform
```

A full example is available in the [examples](./examples) directory.

### JavaScript

```javascript
const { InflatingTransform } = require("inflating-transform");

let stream;

// use props to provide generators to object
stream = new InflatingTransform({
  inflate: function*(chunk, encoding) { yield doSomethingWithChunk(chunk) },
  burst: function*() { yield doSomeFinalWork() }
});

// use generators that yield promises
stream = new InflatingTransform({
  inflate: function*(chunk, encoding) { yield Promise.resolve(doSomethingWithChunk(chunk)) },
  burst: function*() { yield Promise.resolve(doSomeFinalWork()) }
});

// use async generators
stream = new InflatingTransform({
  inflate: async function*(chunk, encoding) { yield doSomethingWithChunk(chunk) }, 
  burst: async function*() { yield doSomeFinalWork() }
});

// use classical OO inheritance
class DoSomethingTransform extends InflatingTransform {
  *_inflate(chunk, encoding) {
    yield this.doSomethingWithChunk(chunk)
  }

  *_burst() {
    yield this.doSomeFinalWork()
  }
}

stream = new DoSomethingTransform();

// use stream overriding transform and flush behaviour
stream = new InflatingTransform({ 
  transform(chunk, encoding, callback) {
    const more = this.push(doSomethingWithChunk(chunk))
    
    if (more) {
      callback()
    } 
    else {
      this.once("ready", callback)
    }
  },
  flush(callback) {
    this.push(null)
     
    callback()
  }
});
```

### TypeScript

```typescript
import { InflatingTransform, InflatedData } from 'inflating-transform';

let stream: InflatingTransform<any, any>;

// use props to provide generators to object
stream = new InflatingTransform<Buffer, string>({
  inflate: function*(chunk: Buffer, encoding?: BufferEncoding): Generator<InflatedData<string>> {
    yield doSomethingWithChunk(chunk)
  },
  burst: function*(): Generator<InflatedData<string> | null> {
    yield doSomeFinalWork()
  }
});

// use generators that yield promises
stream = new InflatingTransform<Buffer, string>({
  inflate: function*(chunk: Buffer, encoding?: BufferEncoding): Generator<Promise<InflatedData<string>>> {
    yield Promise.resolve(doSomethingWithChunk(chunk));
  },
  burst: function*(): Generator<Promise<InflatedData<string>> | null> {
    yield Promise.resolve(doSomeFinalWork());
  }
});

// use async generators
stream = new InflatingTransform<Buffer, string>({
  inflate: async function*(chunk: Buffer, encoding?: BufferEncoding): AsyncGenerator<InflatedData<string>> {
    yield doSomethingWithChunk(chunk)
  },
  burst: async function*(): AsyncGenerator<InflatedData<string> | null> {
    yield doSomeFinalWork()
  }
});

// use classical OO inheritance
class DoSomethingTransform extends InflatingTransform<Buffer, string> {
  *_inflate(chunk: Buffer, encoding?: BufferEncoding): Generator<InflatedData<string>> {
    yield this.doSomethingWithChunk(chunk)
  }

  *_burst(): Generator<InflatedData<string> | null> {
    yield this.doSomeFinalWork()
  }
}

stream = new DoSomethingTransform();

// use stream overriding transform and flush behaviour
stream = new InflatingTransform<Buffer, string>({
  transform(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const more = this.push(doSomethingWithChunk(chunk));
    
    if (more) {
      callback();
    } 
    else {
      this.once("ready", callback);
    }
  },
  flush(callback: (error?: Error | null) => void): void {
    this.push(null);
     
    callback();
  }
});
```

## Tests

```shell
$ npm run test
```
