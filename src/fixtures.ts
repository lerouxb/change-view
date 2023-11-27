import _ from 'lodash';
import { Buffer } from 'buffer';
import {
  BSONRegExp,
  Binary,
  Code,
  DBRef,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  UUID,
  BSONSymbol,
} from 'bson';

import type { Document } from 'bson';

export type Fixture = {
  name: string,
  before: Document,
  after: Document
};

const allTypesDoc: Document = {
  _id: new ObjectId('642d766b7300158b1f22e972'),
  double: new Double(1.2), // Double, 1, double
  string: 'Hello, world!', // String, 2, string
  object: { key: 'value' }, // Object, 3, object
  array: [1, 2, 3], // Array, 4, array
  binData: new Binary(Buffer.from([1, 2, 3])), // Binary data, 5, binData
  // Undefined, 6, undefined (deprecated)
  objectId: new ObjectId('642d766c7300158b1f22e975'), // ObjectId, 7, objectId
  boolean: true, // Boolean, 8, boolean
  date: new Date('2023-04-05T13:25:08.445Z'), // Date, 9, date
  null: null, // Null, 10, null
  regex: new BSONRegExp('pattern', 'i'), // Regular Expression, 11, regex
  // DBPointer, 12, dbPointer (deprecated)
  javascript: new Code('function() {}'), // JavaScript, 13, javascript
  symbol: new BSONSymbol('symbol'), // Symbol, 14, symbol (deprecated)
  javascriptWithScope: new Code('function() {}', { foo: 1, bar: 'a' }), // JavaScript code with scope 15 "javascriptWithScope" Deprecated in MongoDB 4.4.
  int: new Int32(12345), // 32-bit integer, 16, "int"
  timestamp: new Timestamp(new Long('7218556297505931265')), // Timestamp, 17, timestamp
  long: new Long('123456789123456789'), // 64-bit integer, 18, long
  decimal: new Decimal128(
    Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
  ), // Decimal128, 19, decimal
  minKey: new MinKey(), // Min key, -1, minKey
  maxKey: new MaxKey(), // Max key, 127, maxKey

  binaries: {
    generic: new Binary(Buffer.from([1, 2, 3]), 0), // 0
    functionData: new Binary(Buffer.from('//8='), 1), // 1
    binaryOld: new Binary(Buffer.from('//8='), 2), // 2
    uuidOld: new Binary(Buffer.from('c//SZESzTGmQ6OfR38A11A=='), 3), // 3
    uuid: new UUID('AAAAAAAA-AAAA-4AAA-AAAA-AAAAAAAAAAAA'), // 4
    md5: new Binary(Buffer.from('c//SZESzTGmQ6OfR38A11A=='), 5), // 5
    encrypted: new Binary(Buffer.from('c//SZESzTGmQ6OfR38A11A=='), 6), // 6
    compressedTimeSeries: new Binary(
      Buffer.from('c//SZESzTGmQ6OfR38A11A=='),
      7
    ), // 7
    custom: new Binary(Buffer.from('//8='), 128), // 128
  },

  dbRef: new DBRef('namespace', new ObjectId('642d76b4b7ebfab15d3c4a78')), // not actually a separate type, just a convention
};

const allTypesDocChanged: Document = {
  _id: new ObjectId('6564759d220c47fd4c97379c'),
  double: new Double(1.3), // Double, 1, double
  string: 'oh no!', // String, 2, string
  object: { foo: 'bar' }, // Object, 3, object
  array: [1, 2, 3, 4], // Array, 4, array
  binData: new Binary(Buffer.from([1, 2, 3, 4])), // Binary data, 5, binData
  // Undefined, 6, undefined (deprecated)
  objectId: new ObjectId('656475ac220c47fd4c97379d'), // ObjectId, 7, objectId
  boolean: false, // Boolean, 8, boolean
  date: new Date('2023-04-05T13:25:08.446Z'), // Date, 9, date
  null: null, // Null, 10, null
  regex: new BSONRegExp('patterns', 'i'), // Regular Expression, 11, regex
  // DBPointer, 12, dbPointer (deprecated)
  javascript: new Code('function() { /* woop */ }'), // JavaScript, 13, javascript
  symbol: new BSONSymbol('symbols are deprecated'), // Symbol, 14, symbol (deprecated)
  javascriptWithScope: new Code('function() {}', { foo: 'a', bar: '1' }), // JavaScript code with scope 15 "javascriptWithScope" Deprecated in MongoDB 4.4.
  int: new Int32(123456), // 32-bit integer, 16, "int"
  timestamp: new Timestamp(new Long('7218556297505931266')), // Timestamp, 17, timestamp
  long: new Long('1234567891234567890'), // 64-bit integer, 18, long
  decimal: new Decimal128(
    Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17])
  ), // Decimal128, 19, decimal
  minKey: new MinKey(), // Min key, -1, minKey
  maxKey: new MaxKey(), // Max key, 127, maxKey

  binaries: {
    generic: new Binary(Buffer.from([1, 2, 3, 4]), 0), // 0
    functionData: new Binary(Buffer.from('//8= '), 1), // 1
    binaryOld: new Binary(Buffer.from('//8= '), 2), // 2
    uuidOld: new Binary(Buffer.from('0123456789abcdef0123456789abcdef'), 3), // 3
    uuid: new UUID('0e1f691e-d3ed-45d8-a151-cb9c995c50ff'), // 4
    md5: new Binary(Buffer.from('0123456789abcdef0123456789abcdef'), 5), // 5
    encrypted: new Binary(Buffer.from('0123456789abcdef0123456789abcdef'), 6), // 6
    compressedTimeSeries: new Binary(
      Buffer.from('0123456789abcdef0123456789abcdef'),
      7
    ), // 7
    custom: new Binary(Buffer.from('0123456789abcdef0123456789abcdef'), 128), // 128
  },

  dbRef: new DBRef('namespace', new ObjectId('642d76b4b7ebfab15d3c4a79')), // not actually a separate type, just a convention
};

const smallChangeDoc: Document = _.clone(allTypesDoc);

smallChangeDoc.string = 'oh no!';


export const fixtures: Fixture[] = [
  {
    name: 'all types identical',
    before: allTypesDoc,
    after: _.clone(allTypesDoc)
  },
  {
    name: 'small change',
    before: allTypesDoc,
    after: smallChangeDoc
  },
  {
    name: 'simple add',
    before: {},
    after: { foo: 'bar' }
  }, {
    name: 'simple remove',
    before: { foo: 'bar' },
    after: {}
  }, {
    name: 'all types add',
    before: {},
    after: allTypesDoc
  }, {
    name: 'all types remove',
    before: allTypesDoc,
    after: {}
  }, {
    name: 'all types changed',
    before: allTypesDoc,
    after: allTypesDocChanged
  }, {
    name: 'nested change object',
    before: { foo: { bar: 1 }},
    after: { foo: { bar: 'a'}}
  }, {
    name: 'nested change-array',
    before: { foo: { bar: [1] }},
    after: { foo: { bar: ['a']}}
  }, {
    name: 'nested change array deep',
    before: { foo: { bar: [[1]] }},
    after: { foo: { bar: [['a']] }}
  }, {
    name: 'same simple type',
    before: { foo: 1 },
    after: { foo: 2}
  }, {
    name: 'different simple types',
    before: { foo: 1 },
    after: { foo: 'a'}
  }, {
    name: 'simple to object',
    before: { foo: 1 },
    after: { foo: { bar: 'baz' } }
  }, {
    name: 'simple to array',
    before: { foo: 1 },
    after: { foo: [1, 2] }
  }, {
    name: 'object to array',
    before: { foo: { bar: 'baz' } },
    after: { foo: [1, 2] }
  }, {
    name: 'array to object',
    before: { foo: [1, 2] },
    after: { foo: { bar: 'baz' } }
  }, {
    name: 'object to simple',
    before: { foo: { bar: 'baz' } },
    after: { foo: 1 },
  }, {
    name: 'array to simple',
    before: { foo: [1, 2] },
    after: { foo: 1 }
  }, {
    name: 'nested object value',
    before: { foo: { bar: 'baz' } },
    after: { foo: { bar: 1 } }
  }, {
    name: 'array item',
    before: { foo: { bar: ['baz'] } },
    after: { foo: { bar: [1] } }
  }, {
    name: 'nested array item',
    before: { foo: { bar: [['baz']] } },
    after: { foo: { bar: [[1]] } }
  }, {
    name: 'object value nested in an array',
    before: { foo: [{ bar: 1 }] },
    after: { foo: [{ bar: 2 }] }
  }, {
    name: 'simple array',
    before: { foo: [1, 2, 3] },
    after: { foo: ['a', 'b', 'c'] },
  }, {
    name: 'add simple value to array',
    before: { foo: [1, 2, 3] },
    after: { foo: [1, 2, 3, 4] },
  }, {
    name: 'add object to array',
    before: { foo: [{ a: 1}] },
    after: { foo: [{ a: 1}, { bar: 'baz' }] },
  }, {
    name: 'add array to array',
    before: { foo: [[1]] },
    after: { foo: [[1], [2]] },
  }, {
    name: 'remove simple value from array',
    before: { foo: [1, 2, 3] },
    after: { foo: [1, 3] },
  }, {
    name: 'remove object from array',
    before: { foo: [{ a: 1}, { bar: 'baz' }] },
    after: { foo: [{ a: 1}] },
  }, {
    name: 'remove array from array',
    before: { foo: [[1], [2]] },
    after: { foo: [[1]] },
  }, {
    name: 'type change',
    before: { foo: new Double(1.2) },
    after: { foo: new Int32(1) }
  }, {
    name: 'add field',
    before: { foo: 'a' },
    after: { foo: 'a', bar: 'b'}
  }
];


/*
remove array from array
*/