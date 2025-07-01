const { Readable, Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const InflatingTransform = require("../index");

/*
 * This example demonstrates the use of an InflatingTransform stream.
 *
 * In this scenario we generate a list of bank account numbers, and "look up" information
 * about that account to pipe through the stream. Because the actual information about the
 * account is more than the number, we can see the point where the Readable buffer in the
 * transform stream has more data than the Writable buffer (which just has the account numbers).
 * To aid in slowing down the readable side, a delay is added to simulate IO, which is a common
 * use case for streams (e.g.: network, console, etc).
 *
 * This scenario requires the transform stream to slow down and wait for the Readable side to
 * empty before continuing.
 *
 * This example can take ~10-15 seconds to execute with NUM_IDS=1000.
 *
 * $ NUM_IDS=1000 node ./example1.js
 */

// transaction :: () -> Object
const transaction = () => ({
	amount: 100,
	description: "Spending money"
})

// transactions :: Integer -> [Object]
const transactions = (num) => {
	const transactions = []

	for (let i = 0; i < num; i++) {
		transactions.push(transaction())
	}

	return transactions
}

// account :: String -> Object
const account = (accountNumber) => ({
	accountNumber,
	name: "Everyday Savings",
	balance: 1000000,
	transactions: transactions(100)
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

// createAccountFromAccountNumber :: String -> InflatedData String
const createAccountFromAccountNumber = (accountNumber) => ({
	chunk: JSON.stringify(account(accountNumber)),
	encoding: "utf8"
})

class AccountNumberStream extends Readable {
	constructor(ids) {
		super({
			highWaterMark: 1000,
		});

		this._ids = ids;
		this._bytesSent = 0;
	}

	_read(_) {
		let more = true

		while (more) {
			const next = this._ids.next();

			if (next.done) {
				more = this.push(null)
			}
			else {
				const accountNumber = String(next.value)

				this._bytesSent += Buffer.byteLength(accountNumber, "utf8")
				more = this.push(accountNumber)
			}
		}
	}
	bytesSent() {
		return this._bytesSent
	}
}

class CountingStream extends Writable {
	constructor() {
		super({
			decodeStrings: true,
			defaultEncoding: "utf-8",
		});

		this._bytesReceived = 0;
	}

	_write(chunk, encoding, callback) {
		this._bytesReceived += chunk.length

		// artificial delay to slow down transformation
		setTimeout(callback, 10);
	}

	bytesReceived() {
		return this._bytesReceived
	}
}

const main = async () => {
	const numIds = parseInt(process.env.NUM_IDS || 10)
	const accountNumbersStream = new AccountNumberStream(sequenceGenerator(20000000, numIds))
	const countingStream = new CountingStream()
	const accountLookupStream = new InflatingTransform({
		inflate: function*(accountNumber) {
			yield createAccountFromAccountNumber(accountNumber)
		}
	})

	await pipeline(accountNumbersStream, accountLookupStream, countingStream)

	const bytesSent = accountNumbersStream.bytesSent();
	const bytesReceived = countingStream.bytesReceived();
	const inflationFactor = (bytesReceived / bytesSent).toFixed(2);

	console.log(`Bytes sent: ${bytesSent}, bytes received: ${bytesReceived}, inflation factor: ${inflationFactor}x`);
}

main().catch(console.error)
