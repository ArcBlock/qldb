import { isDate, isPlainObject, isArray } from 'lodash';
import AwsSDK, { QLDB as ControlDriver } from 'aws-sdk';
import { PooledQldbDriver as SessionDriver } from 'amazon-qldb-driver-nodejs';
import { makeReader, toBase64 } from 'ion-js';
import { createHash } from 'crypto';

const HASH_LENGTH = 32;

/* eslint-disable */

function parseProof(valueHolder) {
  let proofList = valueHolder.IonText;
  const r = makeReader(proofList);
  r.next();
  r.stepIn();

  proofList = proofList.replace("]", "");
  proofList = proofList.replace("[", "");
  const array = proofList.split(",");

  const byteArray = [];
  for (let i = 0; i < array.length; i++) {
    r.next();
    byteArray.push(r.byteValue());
  }
  return byteArray;
}

function compareHashValues(hash1, hash2) {
  if (hash1.length !== HASH_LENGTH || hash2.length !== HASH_LENGTH) {
    throw new Error("Invalid hash.");
  }
  for (let i = hash1.length - 1; i >= 0; i--) {
    const difference = ((hash1[i] << 24) >> 24) - ((hash2[i] << 24) >> 24);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function concatenate(...arrays) {
  let totalLength = 0;

  for (const arr of arrays) {
    totalLength += arr.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}

function joinHashesPairwise(h1, h2) {
  if (h1.length === 0) {
    return h2;
  }
  if (h2.length === 0) {
    return h1;
  }
  let concat;
  if (compareHashValues(h1, h2) < 0) {
    concat = concatenate(h1, h2);
  } else {
    concat = concatenate(h2, h1);
  }
  const hash = createHash("sha256");
  hash.update(concat);
  const newDigest = hash.digest();
  return newDigest;
}

/* eslint-enable */

function calculateRootHashFromInternalHash(internalHashes, leafHash) {
  return internalHashes.reduce(joinHashesPairwise, leafHash);
}

function buildCandidateDigest(proof, leafHash) {
  const parsedProof = parseProof(proof);
  const rootHash = calculateRootHashFromInternalHash(parsedProof, leafHash);
  return rootHash;
}

export function compare(documentHash, digest, proof) {
  const candidateDigest = buildCandidateDigest(proof, documentHash);
  return toBase64(digest) === toBase64(candidateDigest);
}

export function ionize(entity) {
  let string = '';
  if (isPlainObject(entity)) {
    Object.entries(entity).forEach(([key, value]) => {
      if (isDate(value)) {
        string += `'${key}':\`${value.toISOString()}\`,`;
      } else if (isPlainObject(value)) {
        string += `'${key}':${ionize(value)},`;
      } else if (isArray(value)) {
        string += `'${key}':[${value.map(v => ionize(v)).join(',')}],`;
      } else {
        string += `'${key}':${JSON.stringify(value).replace(/"/gi, "'")},`;
      }
    });
    string = `{${string.slice(0, -1)}}`;
  } else if (isArray(entity)) {
    string = `<<${entity.map(e => ionize(e)).join(',')}>>`;
  } else {
    string = JSON.stringify(entity).replace(/"/gi, "'");
  }
  return string;
}

export function toIonText({ strandId, sequenceNo } = {}) {
  return { IonText: `{strandId: "${strandId}", sequenceNo: ${sequenceNo}}` };
}

export default class QLDB {
  constructor(props = {}) {
    this.props = {
      region: 'us-east-2',
      controlProps: {},
      sessionProps: {},
      ...props,
    };

    if (props.debug) {
      AwsSDK.config.logger = console;
    } else {
      AwsSDK.config.logger = null;
    }

    this.control = new ControlDriver({
      accessKeyId: this.props.accessKey,
      secretAccessKey: this.props.secretKey,
      region: this.props.region,
      ...this.props.controlProps,
    });

    if (this.props.ledger) {
      this.connect(this.props.ledger);
    }
  }

  // TABLE CRUD
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/QLDB.html#createLedger-property
  create(props) {
    return this.control.createLedger(props).promise();
  }

  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/QLDB.html#deleteLedger-property
  delete(props) {
    return this.control.deleteLedger(props).promise();
  }

  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/QLDB.html#listLedgers-property
  list(props) {
    return this.control.listLedgers(props).promise();
  }

  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/QLDB.html#describeLedger-property
  describe(props) {
    return this.control.describeLedger(props).promise();
  }

  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/QLDB.html#updateLedger-property
  update(props) {
    return this.control.describeLedger(props).promise();
  }

  // BLOCKCHAIN
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/QLDB.html#getBlock-property
  block(props) {
    return this.control.getBlock(props).promise();
  }

  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/QLDB.html#getDigest-property
  digest(props) {
    return this.control.getDigest(props).promise();
  }

  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/QLDB.html#getRevision-property
  revision(props) {
    return this.control.getRevision(props).promise();
  }

  // JOURNALS
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/QLDB.html#describeJournalS3Export-property
  journal(props) {
    return this.control.describeJournalS3Export(props).promise();
  }

  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/QLDB.html#exportJournalToS3-property
  exportJournal(props) {
    return this.control.exportJournalToS3(props).promise();
  }

  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/QLDB.html#listJournalS3Exports-property
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/QLDB.html#listJournalS3ExportsForLedger-property
  listJournals(props = {}) {
    if (!props.Name) return this.control.listJournalS3Exports(props).promise();
    return this.control.listJournalS3ExportsForLedger(props).promise();
  }

  // TODO: TAGS

  // EXECUTION
  connect(ledger, sessionProps) {
    if (this.sessionDriver) {
      this.sessionDriver.close();
    }

    this.sessionDriver = new SessionDriver(ledger, {
      accessKeyId: this.props.accessKey,
      secretAccessKey: this.props.secretKey,
      region: this.props.region,
      ...(sessionProps || this.props.sessionProps),
    });
  }

  async session() {
    if (!this.sessionDriver) {
      throw new Error(
        'The driver is not connected to a ledger! Use .connect(ledgerName) before running queries',
      );
    }

    return this.sessionDriver.getSession();
  }

  // eslint-disable-next-line class-methods-use-this
  async execute(query, ops = {}) {
    const { noParse = false, txn } = ops;

    const binaryResult = await txn.execute(query);
    const resultList = binaryResult.getResultList();

    if (noParse) return resultList;

    return JSON.parse(JSON.stringify(resultList));
  }

  async transaction(fn = () => {}) {
    return this.sessionDriver.executeLambda(async (txn) => {
      await fn({
        txn,
        execute: (query, ops) => this.execute(query, { ...ops, txn }),
      });
    });
  }

  async validate(query) {
    const digest = await this.digest({
      Name: this.props.ledger,
    });

    const docs = await this.execute(query);
    const doc = docs[0];

    if (!doc) throw new Error('Datum not found!');

    const revision = await this.revision({
      Name: this.props.ledger,
      BlockAddress: toIonText(doc.blockAddress),
      DigestTipAddress: digest.DigestTipAddress,
      DocumentId: doc.metadata.id,
    });

    return compare(doc.hash, digest.Digest, revision.Proof);
  }
}
