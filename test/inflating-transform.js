const { Readable, Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const InflatingTransform = require("../index");

const {
	assertThat,
	is,
	isRejectedWith,
	allOf,
	instanceOf,
	hasProperty,
	equalTo,
	promiseThat
} = require("hamjest");

const NUM_IDS = parseInt(process.env.NUM_IDS || 10)

describe("InflatingTransform", function() {
	it("should use backpressure correctly", async function() {
		const { count, readyUsed } = await newPipeline(newAccountLookupStream());

		assertThat("Not all ids processed", count, is(NUM_IDS))
		assertThat("Backpressure not used", readyUsed, is(true))
	});

	it("should throw error if inflate is not implemented", async function() {
		const result = newPipeline(newInflatingStream())

		await promiseThat(result, isRejectedWith(allOf(
			instanceOf(Error),
			hasProperty("message", equalTo("Unimplemented"))
		)))
	})

	it("should pass inflate via constructor prop", async function() {
		await newPipeline(
			newInflatingStream(inflatingTransformOptions(withInflate(inflateAccountNumber)))
		)
	})

	it("should handle error from generator", async function() {
		const message = "Inflation error";
		const inflate = function*() { throw new Error(message) }
		const result = newPipeline(
			newInflatingStream(inflatingTransformOptions(withInflate(inflate)))
		)

		await promiseThat(result, isRejectedWith(allOf(
			instanceOf(Error),
			hasProperty("message", equalTo(message))
		)));
	});
});

class GeneratorStream extends Readable {
	constructor(numIds) {
		super({
			objectMode: true,
			highWaterMark: 1000
		});

		this._ids = sequenceGenerator(200000000, numIds)
	}

	_read(size) {
		let more = true

		while (more) {
			const next = this._ids.next();

			if (next.done) {
				more = this.push(null)
			}
			else {
				more = this.push(next.value)
			}
		}
	}
}

class CountingStream extends Writable {
	constructor() {
		super({
			decodeStrings: false,
			defaultEncoding: "utf-8"
		});

		this.count = 0
	}

	_write(chunk, encoding, callback) {
		this.count = this.count + 1

		setTimeout(callback, 10);
	}

	_final(callback) {
		this.emit("count", this.count);

		callback();
	}
}

/*
 * Generates fake account data to test the backpressure.
 */
class AccountLookupStream extends InflatingTransform {
	constructor() {
		super(inflatingTransformOptions());

		this.readyUsed = false
		this.once("ready", () => this.readyUsed = true);
	}

	* _inflate(chunk, encoding) {
		yield createAccountFromAccountNumber(chunk)
	}

	_flush(callback) {
		this.push(null)

		callback()
	}
}

function* inflateAccountNumber(chunk) {
	yield createAccountFromAccountNumber(chunk)
}

// inflatingTransformOptions :: Object? -> Object
const inflatingTransformOptions = (props) => ({
	encoding: "utf-8",
	writableObjectMode: true,
	...props
})

// newPipeline :: (() -> InflatingTransform) -> Promise Error Object
const newPipeline = async (inflatingStream) => {
	let readyUsed = false

	const generatorStream = new GeneratorStream(NUM_IDS);
	const countingStream = new CountingStream();
	const stream = inflatingStream();
	stream.once("ready", () => readyUsed = true);

	await pipeline(generatorStream, stream, countingStream)

	return {
		count: countingStream.count,
		readyUsed: readyUsed
	}
}

// newAccountLookupStream :: () -> () -> AccountLookupStream
const newAccountLookupStream = () => () => new AccountLookupStream()

// newInflatingStream :: InflatingTransformOptions? -> () -> InflatingTransform
const newInflatingStream = (opts = inflatingTransformOptions()) =>
	() => new InflatingTransform(opts)

// withInflate :: (() -> InflatingTransform) -> Object
const withInflate = (fn) => ({
	inflate: fn
})

// createAccountFromAccountNumber :: String -> InflatedData String
const createAccountFromAccountNumber = (accountNumber) => ({
	chunk: JSON.stringify(account(accountNumber)),
	encoding: "utf8"
})

// account :: String -> Object
const account = (accountNumber) => ({
	accountNumber,
	name: "Everyday Savings",
	balance: 1000000,
	transactions: transactions(100)
})

// transactions :: Integer -> [Object]
const transactions = (num) => {
	const transactions = []

	for (let i = 0; i < num; i++) {
		transactions.push(transaction())
	}

	return transactions
}

// transaction :: () -> Object
const transaction = () => ({
	amount: 100,
	description: "Spending money"
})

// sequenceGenerator :: (Integer, Integer) -> Iterator Integer
const sequenceGenerator = (start, num) => {
	const last = start + num
	let next = start

	return ({
		next() {
			return next < last ?
				{
					value: next++,
					done: false
				}
			: {
					value: last,
					done: true
				};
		}
	});
}
