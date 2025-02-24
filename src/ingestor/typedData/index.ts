import snapshot from '@snapshot-labs/snapshot.js';
import relayer, { issueReceipt } from '../../helpers/relayer';
import envelop from './envelop.json';
import { spaces } from '../../helpers/spaces';
import writer from '../../writer';
// import gossip from '../../helpers/gossip';
import { pinJson } from '../../helpers/ipfs';
import { sha256 } from '../../helpers/utils';
import hashTypes from './types.json';

const NAME = 'snapshot';
const VERSION = '0.1.4';

export default async function(body) {
  const schemaIsValid = snapshot.utils.validateSchema(envelop, body);
  if (schemaIsValid !== true) {
    console.log('Wrong envelop format', schemaIsValid);
    return Promise.reject('wrong envelop format');
  }

  const ts = Date.now() / 1e3;
  const overTs = (ts + 300).toFixed();
  const underTs = (ts - 300).toFixed();
  const { domain, message, types } = body.data;

  if (JSON.stringify(body).length > 1e5)
    return Promise.reject('too large message');

  if (message.timestamp > overTs || message.timestamp < underTs)
    return Promise.reject('wrong timestamp');

  if (domain.name !== NAME || domain.version !== VERSION)
    return Promise.reject('wrong domain');

  const hash = sha256(JSON.stringify(types));
  if (!Object.keys(hashTypes).includes(hash))
    return Promise.reject('wrong types');
  let type = hashTypes[hash];

  if (type !== 'settings' && !spaces[message.space])
    return Promise.reject('unknown space');

  // Check if signature is valid
  const isValid = await snapshot.utils.verify(
    body.address,
    body.sig,
    body.data
  );
  if (!isValid) return Promise.reject('wrong signature');
  console.log('Signature is valid');

  let payload = {};

  if (type === 'settings') payload = JSON.parse(message.settings);

  if (type === 'proposal')
    payload = {
      name: message.title,
      body: message.body,
      choices: message.choices,
      start: message.start,
      end: message.end,
      snapshot: message.snapshot,
      metadata: {
        plugins: JSON.parse(message.plugins),
        network: message.network,
        strategies: JSON.parse(message.strategies),
        ...JSON.parse(message.metadata)
      },
      type: message.type
    };

  if (type === 'delete-proposal') payload = { proposal: message.proposal };

  if (['vote', 'vote-array', 'vote-string'].includes(type)) {
    let choice = message.choice;
    if (type === 'vote-string') choice = JSON.parse(message.choice);
    payload = {
      proposal: message.proposal,
      choice,
      metadata: JSON.parse(message.metadata)
    };
    type = 'vote';
  }

  const legacyBody = {
    address: body.address,
    msg: JSON.stringify({
      version: domain.version,
      timestamp: message.timestamp,
      space: message.space,
      type,
      payload
    }),
    sig: body.sig
  };

  try {
    await writer[type].verify(legacyBody);
  } catch (e) {
    console.log(e);
    return Promise.reject(e);
  }

  // @TODO gossip to typed data endpoint
  // gossip(body, message.space);

  const [id, receipt] = await Promise.all([
    pinJson(`snapshot/${body.sig}`, body),
    issueReceipt(body.sig)
  ]);

  try {
    await writer[type].action(legacyBody, id, receipt);
  } catch (e) {
    return Promise.reject(e);
  }

  console.log(
    `Address "${body.address}"\n`,
    `Space "${message.space}"\n`,
    `Type "${type}"\n`,
    `Id "${id}"`
  );

  return {
    id,
    relayer: {
      address: relayer.address,
      receipt
    }
  };
}
