const { Readable, Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const InflatingTransform = require("../index");

const { assertThat, is } = require("hamjest");

const NUM_IDS = parseInt(process.env.NUM_IDS || 10)

describe("InflatingTransform", function() {
	it("should use backpressure correctly", async function() {
		const accountNumbers = new GeneratorStream(NUM_IDS);
		const accountLookup = new AccountLookupStream();
		const counter = new CountingStream();

		await pipeline(accountNumbers, accountLookup, counter);

		const result = counter.count

		assertThat("Not all ids processed", result, is(NUM_IDS))
		assertThat("Backpressure not used", accountLookup.readyUsed, is(true))
	})
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

		while(more) {
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
}

/*
 * Generates fake account data to test the backpressure.
 */
class AccountLookupStream extends InflatingTransform {
	constructor() {
		super({
			encoding: "utf-8",
			writableObjectMode: true
		});

		this.readyUsed = false
	}

	_transform(chunk, encoding, callback) {
		const more = this.push(JSON.stringify(account(chunk)))

		if (!more) {
			this.readyUsed = true

			this.once("ready", callback)

			return
		}

		callback()
	}

	_flush(callback) {
		this.push(null)

		callback()
	}
}

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
