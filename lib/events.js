const abi = require('ethereumjs-abi')

module.exports = {
  BY_ID: new Map(),
  IDS: [],
  DEPOSIT_FACTORY_DEPLOYED: {
    id: id('Deployed(address)'),
    encode (addr) {
      return [
        module.exports.DEPOSIT_FACTORY_DEPLOYED.id,
        '0x' + abi.rawEncode(['address'], [addr]).toString('hex')
      ]
    },
    decode (topics) {
      return {
        name: 'DEPOSIT_FACTORY_DEPLOYED',
        contractAddress: decodeOutput(['address'], topics[1])[0]
      }
    }
  },
  DEPOSIT_FORWARDED: {
    id: id('DepositForwarded(address,uint256)'),
    decode (topics) {
      const args = decodeOutput(['address', 'uint256'], topics[1])
      return {
        name: 'DEPOSIT_FORWARDED',
        to: args[0],
        amount: args[1].toString()
      }
    }
  },
  ERC20_TRANSFER: {
    id: id('Transfer(address,address,uint256)'),
    decode (topics) {
      const args = decodeOutput(['address', 'address', 'uint256'], topics[1])
      return {
        name: 'ERC20_TRANSFER',
        from: args[0],
        to: args[1],
        amount: args[2].toString()
      }
    }
  },
  decode (topics) {
    const e = module.exports.BY_ID.get(topics[0])
    return e ? e.decode(topics) : null
  }
}

for (const k of Object.keys(module.exports)) {
  const v = module.exports[k]
  if (v.id) {
    module.exports.IDS.push(v.id)
    module.exports.BY_ID.set(v.id, v)
  }
}

function id (name) {
  return '0x' + abi.soliditySHA3(['string'], [name]).toString('hex')
}

function decodeOutput (signature, data) {
  const addrIdx = []
  const addrListIdx = []
  if (data[1] === 'x') data = Buffer.from(data.slice(2), 'hex')
  for (var i = 0; i < signature.length; i++) {
    if (signature[i] === 'address') {
      addrIdx.push(i)
    }

    if (signature[i] === 'address[]') {
      addrListIdx.push(i)
    }
  }

  const result = abi.rawDecode(signature, data)

  for (var j = 0; j < addrIdx.length; j++) {
    result[addrIdx[j]] = '0x' + result[addrIdx[j]]
  }

  for (var k = 0; k < addrListIdx.length; k++) {
    result[addrListIdx[k]] = result[addrListIdx[k]].map(a => '0x' + a)
  }

  return result
}
