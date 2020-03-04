const Signal = require('signal-promise')

module.exports = class BlockQueue {
  constructor (nanoeth, opts) {
    this.eth = nanoeth

    this.maxBuffered = opts.maxBuffered || 512
    this.maxParallel = opts.maxParallel || 16
    this.active = 0
    this.blockHeight = 0
    this.confirmations = opts.confirmations === 0 ? 0 : (opts.confirmations || 0)

    this.queued = new Map()
    this.head = opts.since || 0
    this.tail = this.head

    this.destroyed = false
    this.started = null
    this.downloading = new Signal()
    this.queueing = new Signal()
    this.blocking = new Signal()
    this.get = opts.get || (seq => nanoeth.getBlockByNumber('0x' + seq.toString(16)))
  }

  start () {
    if (this.started) return this.started
    if (this.destroyed) return Promise.resolve()
    this.started = this._start()
    this.downloading.notify()
    return this.started
  }

  async _start () {
    let error = null

    try {
      while (!this.destroyed && await this.downloading.wait()) {
        while (!this.destroyed && this.queued.size < this.maxBuffered && this.active < this.maxParallel) {
          await this.confirmed()
          this.push()
        }
      }
    } catch (err) {
      error = err
    }

    await Promise.allSettled([...this.queued.values()])

    if (error) throw error
  }

  async confirmed () {
    while ((this.blockHeight - this.head) < this.confirmations && !this.destroyed) {
      this.blockHeight = Number(await this.eth.blockNumber())
      if ((this.blockHeight - this.head) < this.confirmations) {
        await this.blocking.wait(1000)
        continue
      }
    }
  }

  destroy (err) {
    if (this.destroyed) return Promise.resolve()
    this.destroyed = true

    if (!this.started) return Promise.resolve()

    this.downloading.notify(err)
    this.queueing.notify(err)
    this.blocking.notify(err)

    return this.started
  }

  push () {
    if (this.destroyed) throw new Error('Queue destroyed')

    const n = this.head++
    const p = this._load(n)
    this.queued.set(n, p)
    if (n === this.tail) this.queueing.notify()
    p.catch(err => {
      this.destroy(err)
    })
    return p
  }

  async _load (n) {
    this.active++

    const data = await this.get(n)

    this.active--
    this.downloading.notify()

    return data
  }

  async shift () {
    if (this.destroyed) throw new Error('Queue destroyed')

    let p = this.queued.get(this.tail)

    while (!p && !this.destroyed) {
      await this.queueing.wait()
      p = this.queued.get(this.tail)
    }

    if (this.destroyed) throw new Error('Queue destroyed')

    const n = this.tail++

    const res = await p
    this.queued.delete(n)
    this.downloading.notify()

    return res
  }
}
