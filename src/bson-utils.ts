import _ from 'lodash';
import { EJSON } from 'bson';

import { isSimpleObject } from './shape-utils';

export function stringifyBSON(value: any) {
  if (value?.inspect) {
    // TODO: This is a temporary hack - we'd use our existing formatters to
    // output colourful/rich previews of values, not just plain text and we
    // don't need this behaviour in unBSON() anyway - it doesn't matter that
    // jsondiffpatch sees `new ` when diffing.
    const s = value.inspect();
    if (s.startsWith('new ')) {
      return s.slice(4);
    }
    return s;
  }
  if (value?.toISOString) {
    return value.toISOString();
  }
  return EJSON.stringify(value)
}

export function unBSON(value: any | any[]): any | any[] {
  if (Array.isArray(value)) {
    return value.map(unBSON);
  } else if (isSimpleObject(value)) {
    const mapped: Record<string, any|any[]> = {};
    for (const [k, v] of Object.entries(value)) {
      mapped[k] = unBSON(v);
    }
    return mapped;
  } else if (value?._bsontype) {
    return stringifyBSON(value);
  } else {
    return value;
  }
}

// TODO: this stuff is in hadron-type-checker which is not published. Switch
// over to using that once moved into compass.

const NUMBER_REGEX = /^-?\d+$/;
const BSON_INT32_MAX = 0x7fffffff;
const BSON_INT32_MIN = -0x80000000;
class Int32Check {
  test(string: string) {
    if (NUMBER_REGEX.test(string)) {
      var value = _.toNumber(string);
      return value >= BSON_INT32_MIN && value <= BSON_INT32_MAX;
    }
    return false;
  }
}

class Int64Check {
  test(string: string) {
    if (NUMBER_REGEX.test(string)) {
      return Number.isSafeInteger(_.toNumber(string));
    }
    return false;
  }
}

const INT32_CHECK = new Int32Check();
const INT64_CHECK = new Int64Check();

const numberToBsonType = (number: number) => {
  var string = _.toString(number);
  if (INT32_CHECK.test(string)) {
    return 'Int32';
  } else if (INT64_CHECK.test(string)) {
    return 'Int64';
  }
  return 'Double';
};

const MATCH = /\[object (\w+)\]/;

export function getType(object: any) {
  if (_.hasIn(object, '_bsontype')) {
    if (object._bsontype === 'Long') {
      return 'Int64';
    }
    if (object._bsontype === 'ObjectID') {
      return 'ObjectId';
    }
    if (object._bsontype === 'Symbol') {
      return 'BSONSymbol';
    }
    return object._bsontype;
  }
  if (_.isNumber(object)) {
    return numberToBsonType(object);
  }
  if (_.isPlainObject(object)) {
    return 'Object';
  }
  if (_.isArray(object)) {
    return 'Array';
  }
  return Object.prototype.toString.call(object).replace(MATCH, '$1');
}