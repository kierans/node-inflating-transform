import { Transform, TransformOptions } from 'node:stream';

/**
 * Represents data that has been inflated by the transform stream
 */
export interface InflatedData<T> {
  /** The chunk to push to the Readable stream buffer */
  chunk: T;

  /**
   * If the chunk is a string, then this is the encoding type.
   * If chunk is a buffer, then this is the special value 'buffer'.
   * Else undefined
   */
  encoding?: BufferEncoding;
}

/**
 * Generator function that inflates input chunks into output chunks
 */
export interface InflatingGenerator<A, B> {
  /**
   * @param chunk A chunk of data written to the stream
   * @param encoding If the chunk is a string, then this is the encoding type. If chunk is a buffer, then this is the special value 'buffer'. Else undefined
   * @yields Data to be pushed to the Readable buffer
   */
  (chunk: A, encoding?: BufferEncoding): Generator<InflatedData<B> | Promise<InflatedData<B>>> | AsyncGenerator<InflatedData<B>>;
}

/**
 * Generator function that produces additional chunks when the stream is flushed
 */
export interface BurstingGenerator<B> {
  /**
   * @yields Data to be pushed to the Readable buffer. Should yield `null` to indicate that the stream is finished.
   */
  (): Generator<InflatedData<B> | Promise<InflatedData<B>> | null> | AsyncGenerator<InflatedData<B> | null>;
}

/**
 * Options for the InflatingTransform stream
 */
export interface InflatingTransformOptions<A, B> extends TransformOptions {
  /** The generator to use to process chunks written to the stream */
  inflate?: InflatingGenerator<A, B>;

  /** The generator to use to when the stream is flushed */
  burst?: BurstingGenerator<B>;
}

/**
 * A Transform stream that handles large volumes of data.
 */
export class InflatingTransform<A = any, B = any> extends Transform {
  /**
   * @param opts Options for the transform stream
   */
  constructor(opts?: InflatingTransformOptions<A, B>);
}
