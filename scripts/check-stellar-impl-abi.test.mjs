import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkCalls,
  extractContractCalls,
  extractRustSignatures,
  splitTopLevel,
} from './check-stellar-impl-abi.mjs'

const LIB_RS = `
#[contractimpl]
impl TokenFactory {
    pub fn set_whitelist_enabled(env: Env, admin: Address, enabled: bool) -> Result<(), Error> {
        Ok(())
    }

    pub fn set_fee_split(env: Env, admin: Address, splits: Map<Address, u32>) -> Result<(), Error> {
        Ok(())
    }

    pub fn mint_tokens(
        env: Env,
        token_address: Address,
        admin: Address,
        amount: i128,
    ) -> Result<(), Error> {
        Ok(())
    }

    fn private_helper(env: &Env, a: u32) {}
}
`

describe('splitTopLevel', () => {
  it('ignores nested commas, comments and trailing commas', () => {
    assert.deepEqual(splitTopLevel('a(1, 2), [3, 4], // x, y\n b,'), ['a(1, 2)', '[3, 4]', 'b'])
  })

  it('only nests on angle brackets when asked', () => {
    assert.equal(splitTopLevel('m: Map<A, B>', { angleBrackets: true }).length, 1)
    assert.equal(splitTopLevel('(x) => x > 1, y').length, 2)
  })
})

describe('extractRustSignatures', () => {
  it('counts caller-supplied params, excluding env, generics and trailing commas', () => {
    const sigs = extractRustSignatures(LIB_RS)
    assert.equal(sigs.get('set_whitelist_enabled'), 2)
    assert.equal(sigs.get('set_fee_split'), 2)
    assert.equal(sigs.get('mint_tokens'), 3)
    assert.equal(sigs.has('private_helper'), false)
  })

  it('throws when there is no impl block', () => {
    assert.throws(() => extractRustSignatures('fn main() {}'), /impl TokenFactory/)
  })
})

describe('extractContractCalls', () => {
  it('counts args after the name for inline and prettier-wrapped calls', () => {
    const calls = extractContractCalls(`
      contract.call('set_whitelist_enabled', a.toScVal(), nativeToScVal(x, { type: 'bool' }))
      contract.call(
        'mint_tokens',
        new Address(t).toScVal(), // token_address, first
        new Address(s).toScVal(),
        nativeToScVal(BigInt(n), { type: 'i128' }),
      )
    `)
    assert.deepEqual(
      calls.map((c) => [c.functionName, c.argumentCount]),
      [
        ['set_whitelist_enabled', 2],
        ['mint_tokens', 3],
      ],
    )
  })
})

describe('checkCalls', () => {
  const sigs = extractRustSignatures(LIB_RS)
  const call = (functionName, argumentCount) => ({ functionName, argumentCount, location: 'x' })

  it('passes exact matches', () => {
    assert.equal(checkCalls(sigs, [call('mint_tokens', 3)]).ok, true)
  })

  it('fails when a single argument is missing or extra', () => {
    // Regression: the previous ±1 tolerance let both of these through.
    assert.equal(checkCalls(sigs, [call('mint_tokens', 2)]).ok, false)
    assert.equal(checkCalls(sigs, [call('mint_tokens', 4)]).ok, false)
  })

  it('fails for unknown functions', () => {
    assert.equal(checkCalls(sigs, [call('nope', 0)]).ok, false)
  })
})
