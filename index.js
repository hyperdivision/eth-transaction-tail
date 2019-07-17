const Web3 = require('web3')
const InputDataDecoder = require('ethereum-input-data-decoder')
const decoder = new InputDataDecoder(`${__dirname}/abi.json`)

module.exports = class TransactionTail {
  constructor (rpc, opts) {
    if (!opts) opts = {}

    this.erc20 = new Map(toArray(opts.erc20 || {}))
    this.web3 = new Web3(new Web3.providers.HttpProvider(rpc))
    this.filter = opts.filter || (() => true)
    this.index = opts.since || 0
    this.confirmations = opts.confirmations || 0

    this._checkpoint = opts.checkpoint || noop
    this._transaction = opts.transaction || noop
  }

  async start () {
    while (true) {
      const want = this.index
      const confirmations = await this._confirmed(want)

      const block = await this.web3.eth.getBlock(want, true)
      if (!block || !block.transactions) continue

      for (let i = 0; i < block.transactions.length; i++) {
        const t = block.transactions[i]

        if (t.to && this.erc20.has(t.to.toLowerCase())) {
          await this._onerc20to(confirmations, i, t, this.erc20.get(t.to.toLowerCase()))
          continue
        }

        if (t.from && this.erc20.has(t.from.toLowerCase())) {
          await this._onerc20from(confirmations, i, t, this.erc20.get(t.from.toLowerCase()))
          continue
        }

        if (!(await this._filter(t.to, 'to') || await this._filter(t.from, 'from'))) continue

        await this._onnormal(confirmations, i, t)
      }

      await this._checkpoint(++this.index)
    }
  }

  async _filter (addr, dir) {
    return !!addr && this.filter(addr, dir)
  }

  async _onnormal (confirmations, transactionIndex, t) {
    await this._transaction({
      erc20: null,
      blockHash: t.blockHash,
      blockNumber: t.blockNumber,
      transactionIndex,
      confirmations,
      hash: t.hash,
      succeeded: (await this.web3.eth.getTransactionReceipt(t.hash)).status,
      from: t.from,
      to: t.to,
      value: t.value
    })
  }

  async _onerc20to (confirmations, transactionIndex, t, erc20) {
    const input = decoder.decodeData(t.input)

    if (input.method === 'transfer') {
      const to = normaliseAddr(input.inputs[0])

      if (!(await this._filter(t.from, 'from') || await this._filter(to, 'to'))) return

      await this._transaction({
        erc20,
        blockHash: t.blockHash,
        blockNumber: t.blockNumber,
        transactionIndex,
        confirmations,
        hash: t.hash,
        succeeded: (await this.web3.eth.getTransactionReceipt(t.hash)).status,
        from: t.from,
        to,
        value: input.inputs[1].toString()
      })
    } else if (input.method === 'transferFrom') {
      const from = normaliseAddr(input.inputs[0])
      const to = normaliseAddr(input.inputs[1])

      if (!(await this._filter(from, 'from') || await this._filter(to, 'to'))) return

      await this._transaction({
        erc20,
        blockHash: t.blockHash,
        blockNumber: t.blockNumber,
        confirmations,
        transactionIndex,
        hash: t.hash,
        succeeded: (await this.web3.eth.getTransactionReceipt(t.hash)).status,
        from,
        to,
        value: input.inputs[2].toString()
      })
    }
  }

  async _onerc20from (transactionIndex, t, name) {
    console.log('onerc20 from', t, transactionIndex)
    await sleep(10000000)
  }

  async _confirmed (n) {
    while (true) {
      const height = await this.web3.eth.getBlockNumber()

      if (n >= (height - this.confirmations)) {
        await sleep(1000)
        continue
      }

      return height - n
    }
  }
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function noop () {}

function toArray (obj) {
  return Object.keys(obj).map(name => [obj[name].toLowerCase(), name])
}

function normaliseAddr (addr) {
  return addr.startsWith('0x') ? addr : '0x' + addr
}
