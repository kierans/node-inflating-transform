# inflating-transform

A Transform is a Duplex stream, in that it is Readable and Writable. It therefore has two
buffers, a write buffer and a read buffer. The write buffer holds data from calls to `write`
and the read buffer holds data that is consumed by calls to `read`. Data from the write
buffer is given to the `transform` method of the Transform stream. Implementations of
`transform` have to [add output to the read buffer][3] via calls to `push`.

A common scenario can occur when a Transform is outputting more data than it is receiving
into the transformation process. For example, when unzipping or inflating compressed data,
the output from the stream is larger than the input. In this scenario it is not uncommon
to fill the read buffer faster than it can be consumed.

The Writable stream has a mechanism for signaling when it is full and consumers have to
pause. When the write buffer is full, `write` will return false, and the client
needs to wait for the `drain` event before writing more data.

When adding data to the Readable read buffer, the `push` method is used. However, if the
consumer of the Readable is slower than the transform is pushing data (for example printing
to stdout), `push` will return false. How is the `transform` method to know when it can
continue to push data? Turns out there isn't an event for that.

By reading the docs on [push][1] and [_read][2] we can see that when a consumer is wanting to
read more data from the Readable, `_read` will be called. Therefore, we can emulate what
the `drain` event does by emitting an event to signal when the caller is ready for more data.
An `InflatingTransform` will emit the `ready` event as part of the call to `_read`.

Subclasses should wait for the `ready` event if `push` returns false.

[1]: https://nodejs.org/docs/latest-v18.x/api/stream.html#readablepushchunk-encoding
[2]: https://nodejs.org/docs/latest-v18.x/api/stream.html#readable_readsize
[3]: https://nodejs.org/docs/latest-v18.x/api/stream.html#transform_transformchunk-encoding-callback

## Usage

```shell
$ npm install inflating-transform
```

```javascript
const stream = new InflatingTransform({ 
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
})
```

## Tests

```shell
$ npm run test
```
