import _ from 'lodash';
import React, { useState, useContext, createContext } from 'react';

import type { Document } from 'bson';
import { EJSON } from 'bson';
import type { Delta } from 'jsondiffpatch';
import jsondiffpatch from 'jsondiffpatch';

import './jsondiffpatch.css';
import './change-view.css';

const diffpatcher = jsondiffpatch.create({
  arrays: {
    detectMove: false
  },
  textDiff: {
    minLength: Infinity // don't do a text diff on bson values
  },
  objectHash: function (obj: any) {
    // probably not the most efficient, but gets the job done
    return stringify(obj);
  }
});

type ObjectPath = (string | number)[];

function isSimpleObject(value: any) {
  return Object.prototype.toString.call(value) === '[object Object]' && !value._bsontype;
}

function stringify(value: any) {
  if (value?.inspect) {
    // TODO: this is a hack - we'd use our existing formatters
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

function pathToKey(path: ObjectPath, changeType: ChangeType) {
  const parts: string[] = [];
  for (const part of path) {
    if (typeof part === 'string') {
      // not actually sure about escaping here. only really matters if we ever
      // want to parse this again which is unlikely
      parts.push(`["${part.replace(/"/g, '\\')}"]`);
    }
    else {
      parts.push(`[${part}]`);
    }
  }
  return parts.join('')+'_'+changeType;
}


type ChangeType = 'unchanged'|'changed'|'added'|'removed';

type ObjectWithChange = {
  implicitChangeType: ChangeType;
  changeType: ChangeType;
  leftPath?: ObjectPath;
  leftValue?: any | any[];
  rightPath?: ObjectPath;
  rightValue?: any | any[];
  delta: Delta | null;
};

type PropertyWithChange = ObjectWithChange & {
  objectKey: string;
};

function getImplicitChangeType(obj: ObjectWithChange) {
  if (['added', 'removed'].includes(obj.implicitChangeType)) {
    // these are "sticky" as we descend
    return obj.implicitChangeType;
  }

  return obj.changeType;
}

function assert(bool: boolean, message: string) {
  if (!bool) {
    throw new Error(message);
  }
}

type Branch = {
  path: ObjectPath;
  value: any | any[];
};

type BranchesWithChanges = {
  delta: Delta | null, // delta is null for unchanged branches
  implicitChangeType: ChangeType
} & (
  | { left: Branch, right: Branch } // changed | unchanged
  | { left: never, right: Branch } // added
  | { left: Branch, right: never } // removed
);

function propertiesWithChanges({
  left,
  right,
  delta,
  implicitChangeType
}: BranchesWithChanges) {
  // for unchanged, changed or removed objects we use the left value, otherwise
  // we use the right value because that's the only one available
  const value = implicitChangeType === 'added' ? right.value : left.value;

  const properties: PropertyWithChange[] = Object.entries(value).map(([objectKey, leftValue]) => {
    const leftPath = left ? [...left.path as ObjectPath, objectKey]
      : right ? undefined
      : [objectKey];

    const rightPath = right ? [...right.path as ObjectPath, objectKey]
      : left ? undefined
      : [objectKey];

    const property: PropertyWithChange = {
      implicitChangeType,
      // might change changeType to 'changed' or 'removed' below
      changeType: 'unchanged',
      objectKey,
      leftValue: leftPath ? leftValue : undefined,
      // we'll fill in rightValue below if the value was added. This is just
      // handling the case where it didn't change.
      rightValue: rightPath && right ? right.value[objectKey] : undefined,
      leftPath,
      // we'll remove rightPath below if the value was removed
      rightPath,
      // we'll fill in delta below if this is an unchanged object with changes somewhere inside it
      // ie. { foo: {} } => foo: { bar: 'baz' }. foo's value is "unchanged"
      // itself, but it has a delta because bar inside it changed.
      delta: null
    };
    return property;
  });

  if (delta) {
    assert(isSimpleObject(delta), 'delta should be a simple object');
    for (const [key, change] of Object.entries(delta)) {
      /*
      delta = {
        property1: [ rightValue1 ], // obj[property1] = rightValue1
        property2: [ leftValue2, rightValue2 ], // obj[property2] = rightValue2 (and previous value was leftValue2)
        property5: [ leftValue5, 0, 0 ] // delete obj[property5] (and previous value was leftValue5)
      }
      */
      if (Array.isArray(change)) {
        if (change.length === 1) {
          // add
          properties.push({
            implicitChangeType,
            changeType: 'added',
            objectKey: key,
            // NOTE: no leftValue or leftPath
            rightValue: change[0],
            rightPath: [...right.path, key],
            delta: null
          });
        } else if (change.length === 2) {
          // update
          const existingProperty = properties.find((p) => p.objectKey === key);
          if (existingProperty) {
            existingProperty.rightValue = change[1]; // 0 is the old value
            existingProperty.changeType = 'changed';
          } else {
            assert(false, `property with key "${key} does not exist"`);
          }
        } else if (change.length === 3) {
          // delete
          const existingProperty = properties.find((p) => p.objectKey === key);
          if (existingProperty) {
            existingProperty.changeType = 'removed';
            delete existingProperty.rightValue;
            delete existingProperty.rightPath;
          } else {
            assert(false, `property with key "${key} does not exist"`);
          }
        } else {
          assert(false, 'unexpected change length');
        }
      } else {
        assert(isSimpleObject(change), 'change should be a simple object');
        // unchanged, so we pass the delta along
        const existingProperty = properties.find((p) => p.objectKey === key);
        if (existingProperty) {
          existingProperty.delta = change;
        } else {
          assert(false, `property with key "${key} does not exist"`);
        }
      }
    }
  }

  // turn changes where the type changed into remove followed by add because we can't easily visualise it on one line
  let changed = true;
  while (changed) {
    changed = false;
    const index = properties.findIndex((property) => {
      if (property.changeType === 'changed') {
        const beforeType = getType(property.leftValue);
        const afterType = getType(property.rightValue);
        if (beforeType !== afterType) {
          return true;
        }
      }
      return false;
    });
    if (index !== -1) {
      const property = properties[index];
      changed = true;
      const deleteProperty: PropertyWithChange = {
        implicitChangeType,
        changeType: 'removed',
        objectKey: property.objectKey,
        leftPath: property.leftPath,
        leftValue: property.leftValue,
        delta: null
      };

      const addProperty: PropertyWithChange = {
        implicitChangeType,
        changeType: 'added',
        objectKey: property.objectKey,
        rightPath: property.leftPath,
        rightValue: property.rightValue,
        delta: null
      };
      properties.splice(index, 1, deleteProperty, addProperty);
    }
  }

  for (const property of properties) {
    if (property.leftPath && property.leftValue === undefined) {
      console.log(property);
      assert(false, 'property: leftPath, but no leftValue')
    }

    if (property.rightPath && property.rightValue === undefined) {
      console.log(property, property.rightPath, property.rightValue);
      assert(false, 'property: rightPath, but no rightValue')
    }

    if (property.leftValue !== undefined && !property.leftPath) {
      console.log(property);
      assert(false, 'property: leftValue, but no leftPath')
    }

    if (property.rightValue !== undefined && !property.rightPath) {
      console.log(property);
      assert(false, 'property: rightValue, but no rightPath')
    }
  }

  return properties;
}

function getType(value: any) {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (isSimpleObject(value)) {
    return 'object';
  }
  return 'leaf';
}

type ItemWithChange = ObjectWithChange & {
  index: number;
};

function itemsWithChanges({
  left,
  right,
  delta,
  implicitChangeType
}: BranchesWithChanges) {
  // for unchanged, changed or removed objects we use the left value, otherwise
  // we use the right value because that's the only one available
  const value = (implicitChangeType === 'added' ? right.value : left.value) as any[];

  const items: ItemWithChange[] = value.map((leftValue, index) => {
    const leftPath = left ? [...left.path as ObjectPath, index]
      : right ? undefined
      : [index];

    const rightPath = right ? [...right.path as ObjectPath, index]
      : left ? undefined
      : [index];

    const item: ItemWithChange = {
      implicitChangeType,
      // we might change changeType to 'removed' below. arrays don't have
      // 'changed'. Only unchanged, added or removed.
      changeType: 'unchanged',
      index,
      leftValue: leftPath ? leftValue : undefined,
      rightValue: rightPath ? leftValue : undefined, // assume it is unchanged
      // we'll fill in rightValue below if the value was added
      leftPath,
      // This only handles the case where the value is unchanged. we'll remove
      // rightPath below if the value was removed. we don't have arrays that
      // have changed values. only unchanged, added or removed.
      rightPath,
      // we'll fill in delta below if this is an unchanged array with changes somewhere inside it
      // ie. { foo: [] } => { foo: [1] }. foo's value is "unchanged" itself, but
      // it has a delta because 1 is added inside it
      delta: null
    };
    return item;
  });

  if (delta) {
    assert(delta._t === 'a', 'delta._t is not a');
    const toRemove = Object.keys(delta)
      .filter((key) => key.startsWith('_') && key !== '_t')
      .map((key) => key.slice(1) as unknown as number);

    // removed indexes refer to the original (left) which is why we remove in a
    // separate pass before updating/adding
    for (const index of toRemove) {
      // removed
      const existingItem = items[index];
      if (existingItem) {
        items[index].changeType = 'removed';
        delete items[index].rightValue;
        delete items[index].rightPath;
      }
      else {
        assert(false, `item with index "${index}" does not exist`);
      }

      // adjust the indexes of all items after this one
      for (const item of items) {
        if (item.index > index) {
          item.index = item.index - 1;
        }
      }
    }

    for (const [_index, change] of Object.entries(delta)) {
      if (_index.startsWith('_')) {
        // already handled
        continue;
      }
      else {
        // non-removed indexes refer to the final (right) array which is why we
        // update/add in a separate pass after removing

        const index = _index as unknown as number;
        if (Array.isArray(change)) {
          assert(change.length !== 3, 'array moves are not supported');
          assert(change.length !== 2, 'array changes are not supported'); // always add and remove

          // added

          // adjust the indexes of all items after this one
          for (const item of items) {
            if (item.index >= index && item.changeType !== 'removed') {
              item.index = item.index + 1;
            }
          }

          items.splice(index, 0, {
            implicitChangeType,
            changeType: 'added',
            index,
            // NOTE: no leftValue or leftPath
            rightPath: [...(right ?? left).path, index],
            rightValue: change[0],
            delta: null,
          });

        }
        else {
          // for nested arrays we fill the delta
          items[index].delta = change;
        }
      }
    }
  }

  // turn changes where the type changed into remove followed by add because we can't easily visualise it on one line
  // TODO: is this even possible? Just said there is no "changed" in arrays above..
  let changed = true;
  while (changed) {
    changed = false;
    const index = items.findIndex((item) => {
      if (item.changeType === 'changed') {
        const beforeType = getType(item.leftValue);
        const afterType = getType(item.rightValue);
        if (beforeType !== afterType) {
          return true;
        }
      }
      return false;
    });
    if (index !== -1) {
      const property = items[index];
      changed = true;
      const deleteItem: ItemWithChange = {
        implicitChangeType,
        changeType: 'removed',
        index: property.index,
        leftPath: property.leftPath,
        leftValue: property.leftValue,
        delta: null
      };

      const addItem: ItemWithChange = {
        implicitChangeType,
        changeType: 'added',
        index: property.index,
        rightPath: property.leftPath,
        rightValue: property.rightValue,
        delta: null
      };
      items.splice(index, 1, deleteItem, addItem);
    }
  }

  for (const item of items) {
    if (item.leftPath && item.leftValue === undefined) {
      console.log(item);
      assert(false, 'item: leftPath, but no leftValue')
    }

    if (item.rightPath && item.rightValue === undefined) {
      console.log(item, item.rightPath, item.rightValue);
      assert(false, 'item: rightPath, but no rightValue')
    }

    if (item.leftValue !== undefined && !item.leftPath) {
      console.log(item);
      assert(false, 'item: leftValue, but no leftPath')
    }

    if (item.rightValue !== undefined && !item.rightPath) {
      console.log('moo', item);
      assert(false, 'item: rightValue, but no rightPath')
    }
  }

  return items;
}

function ChangeArrayItemArray({
  item,
}: {
  item: ItemWithChange,
}) {
  const [isOpen, setIsOpen] = useState(!!item.delta || item.changeType !== 'unchanged');

  const toggleIsOpen = function () {
    setIsOpen(!isOpen);
  };

  //const value = item.changeType === 'added' ? item.rightValue : item.leftValue;
  //const numItems = value.length;
  //const text = `Array (${numItems})`;
  const text = 'Array';

  return (<div className="change-array-item change-array-item-array">
    <div className={`change-array-item-summary change-summary-${getChangeType(item)}`}>
      <button className="toggle-array-item" onClick={toggleIsOpen}>{isOpen ? '-' : '+'}</button>
      <div className="change-array-index">{item.index}:</div>
      <div className="change-array-item-summary-text">{text}</div>
    </div>
    <ChangeArray obj={item} isOpen={isOpen}/>
  </div>);
}

function ChangeArrayItemObject({
  item,
}: {
  item: ItemWithChange,
}) {

  const [isOpen, setIsOpen] = useState(!!item.delta || item.changeType !== 'unchanged');

  const toggleIsOpen = function () {
    setIsOpen(!isOpen);
  };

  //const value = item.changeType === 'added' ? item.rightValue : item.leftValue;
  //const numKeys = Object.keys(value).length;
  //const text = `Object (${numKeys})`;
  const text = 'Object';

  return (<div className="change-array-item change-array-item-object">
    <div className={`change-array-item-summary change-summary-${getChangeType(item)}`}>
      <button className="toggle-array-item" onClick={toggleIsOpen}>{isOpen ? '-' : '+'}</button>
      <div className="change-array-index">{item.index}:</div>
      <div className="change-array-item-summary-text">{text}</div>
    </div>
    <ChangeObject obj={item} isOpen={isOpen} />
  </div>);
}

function ChangeArrayItemLeaf({
  item,
}: {
  item: ItemWithChange,
}) {

  return (<div className="change-array-item change-array-item-leaf">
    <div className={`change-array-item-summary change-summary-${getChangeType(item)}`}>
      <div className="change-array-index">{item.index}:</div>
      <div className="change-array-item-value"><ChangeLeaf obj={item} /></div>
    </div>
  </div>);
}

function ChangeArrayItem({
  item,
}: {
  item: ItemWithChange,
}) {
  const value = item.changeType === 'added' ? item.rightValue : item.leftValue;
  if (Array.isArray(value)) {
    // array summary followed by array items if expanded
    return <ChangeArrayItemArray item={item} />
  } else if (isSimpleObject(value)) {
    // object summary followed by object properties if expanded
    return <ChangeArrayItemObject item={item} />
  }

  // simple/bson value only
  return <ChangeArrayItemLeaf item={item} />
}

function Sep() {
  return <span className="separator">, </span>;
}

function getPath(obj: ObjectWithChange) {
  return (obj.rightPath ?? obj.leftPath) as ObjectPath;
}

function ChangeArray({
  obj,
  isOpen
}: {
  obj: ObjectWithChange,
  isOpen: boolean
}) {
  const implicitChangeType = getImplicitChangeType(obj);
  const items = itemsWithChanges({
    left: obj.leftPath ? {
      path: obj.leftPath as ObjectPath,
      value: obj.leftValue as any | any[]
    } as Branch : undefined,
    right: obj.rightPath ? {
      path: obj.rightPath as ObjectPath,
      value: obj.rightValue as any | any[]
    } as Branch : undefined,
    delta: obj.delta,
    implicitChangeType
  } as BranchesWithChanges);

  if (isOpen) {
    // TODO: this would be even nicer in place of the "Array" text and then we
    // don't even have to make the object key expandable or not, but that
    // requires itemsWithChanges() being called one level up

    // TODO: we might want to go further and only do this for simple values like
    // strings, numbers, booleans, nulls, etc. ie. not bson types because some
    // of those might  take up a lot of space?
    if (items.every((item) => getType(item.changeType === 'added' ? item.rightValue : item.leftValue) === 'leaf')) {
      // if it is an array containing just simple values then we can special-case it and output it all on one line
      const classes = ['change-array-inline'];

      if (implicitChangeType === 'added') {
        classes.push('change-array-inline-added');
      }

      if (implicitChangeType === 'removed') {
        classes.push('change-array-inline-removed');
      }


      return (<div className="change-array-inline-wrap"><div className={classes.join(' ')}>[
        {items.map((item, index) => {
          const key = pathToKey(getPath(item), item.changeType);
          return <span key={key}>
            <ChangeLeaf obj={item} />
            {index !== items.length -1 && <Sep/>}
          </span>
        })}
      ]</div></div>)
    }

    return (<div className="change-array">
      {items.map((item) => {
        const key = pathToKey(getPath(item), item.changeType);
        return <ChangeArrayItem key={key} item={item}/>
      })}
    </div>);
  }

  return null;
}

function ChangeObjectPropertyObject({
  property
}: {
  property: PropertyWithChange
}) {
  const [isOpen, setIsOpen] = useState(!!property.delta || property.changeType !== 'unchanged');

  const toggleIsOpen = function () {
    setIsOpen(!isOpen);
  };

  //const value = property.changeType === 'added' ? property.rightValue : property.leftValue;
  //const numKeys = Object.keys(value).length;
  //const text = `Object (${numKeys})`;
  const text = 'Object';

  return (<div className="change-object-property change-object-property-object">
    <div className={`change-object-property-summary change-summary-${getChangeType(property)}`}>
      <button className="toggle-object-property" onClick={toggleIsOpen}>{isOpen ? '-' : '+'}</button>
      <div className="change-object-key">{property.objectKey}:</div>
      <div className="change-object-property-summary-text">{text}</div>
    </div>
    <ChangeObject obj={property} isOpen={isOpen} />
  </div>);
}

function ChangeObjectPropertyArray({
  property
}: {
  property: PropertyWithChange
}) {
  const [isOpen, setIsOpen] = useState(!!property.delta || property.changeType !== 'unchanged');

  const toggleIsOpen = function () {
    setIsOpen(!isOpen);
  };

  //const value = property.changeType === 'added' ? property.rightValue : property.leftValue;
  //const numItems = value.length;
  //const text = `Array (${numItems})`;
  const text = 'Array';

  return (<div className="change-object-property change-object-property-array">
    <div className={`change-object-property-summary change-summary-${getChangeType(property)}`}>
      <button className="toggle-object-property" onClick={toggleIsOpen}>{isOpen ? '-' : '+'}</button>
      <div className="change-object-key">{property.objectKey}:</div>
      <div className="change-object-property-summary-text">{text}</div>
    </div>
    <ChangeArray obj={property} isOpen={isOpen}/>
  </div>);
}

function ChangeObjectPropertyLeaf({
  property
}: {
  property: PropertyWithChange
}) {
  return (<div className="change-object-property change-object-property-leaf">
    <div className={`change-object-property-summary change-summary-${getChangeType(property)}`}>
      <div className="change-object-key">{property.objectKey}:</div>
      <div className="change-object-property-value"><ChangeLeaf obj={property} /></div>
    </div>
  </div>);
}

function ChangeObjectProperty({
  property
}: {
  property: PropertyWithChange
}) {
  const value = property.changeType === 'added' ? property.rightValue : property.leftValue;
  if (Array.isArray(value)) {
    // array summary followed by array items if expanded
    return <ChangeObjectPropertyArray property={property}/>
  } else if (isSimpleObject(value)) {
    // object summary followed by object properties if expanded
    return <ChangeObjectPropertyObject property={property} />
  }

  // simple/bson value only
  return <ChangeObjectPropertyLeaf property={property} />
}

function ChangeObject({
  obj,
  isOpen
}: {
  obj: ObjectWithChange,
  isOpen: boolean
}) {
  // A sample object / sub-document. ie. not an array and not a leaf.
  const implicitChangeType = getImplicitChangeType(obj);
  const properties = propertiesWithChanges({
    left: obj.leftPath ? {
      path: obj.leftPath as ObjectPath,
      value: obj.leftValue as any | any[]
    } as Branch : undefined,
    right: obj.rightPath ? {
      path: obj.rightPath as ObjectPath,
      value: obj.rightValue as any | any[]
    } as Branch : undefined,
    delta: obj.delta,
    implicitChangeType
  } as BranchesWithChanges);
  if (isOpen) {
    return (<div className="change-object">
      {properties.map((property) => {
        const key = pathToKey(getPath(property), property.changeType);
        return <ChangeObjectProperty key={key} property={property} />
      })}
    </div>);
  }

  return null
}

function getLeftClassName(obj: ObjectWithChange) {
  // TODO: this is a complete mess and has to be rewritten

  if (obj.implicitChangeType === 'removed') {
    return 'change-removed';
  }

  if (obj.implicitChangeType === 'added' && obj.changeType === 'unchanged') {
    return 'change-added';
  }

  if (obj.implicitChangeType === 'added' || obj.changeType === 'added') {
    return 'change-added';
  }

  if (obj.changeType === 'unchanged') {
    return 'unchanged';
  }

  return obj.changeType === 'changed' ? 'change-removed' : 'removed';
}

function getRightClassName(obj: ObjectWithChange) {
  if (obj.implicitChangeType === 'added') {
    return 'change-added';
  }

  return obj.changeType === 'changed' ? 'change-added' : 'added';
}

function getChangeType(obj: ObjectWithChange) {
  if (['added', 'removed'].includes(obj.implicitChangeType)) {
    // these are "sticky" as we descend
    return obj.implicitChangeType;
  }

  return obj.changeType;
}

function lookupValue(path: ObjectPath, value: any): any {
  const [head, ...rest] = path;
  if (rest.length) {
    return lookupValue(rest, value[head]);
  }
  return value[head];
}

function ChangeLeaf({
  obj,
}: {
  obj: ObjectWithChange
}) {
  // Anything that is not an object or array. This includes simple javascript
  // values like strings, numbers, booleans and undefineds, but also dates or
  // bson values.
  const { left, right } = useContext(LeftRightContext) as LeftRightContextType;

  const toString = (path: ObjectPath, value: any) => {
    const v = lookupValue(path, value);
    return stringify(v);
  };

  const changeType = getChangeType(obj);
  const includeLeft = ['unchanged', 'changed', 'removed'].includes(changeType);
  if (includeLeft) {
    if (!obj.leftPath) {
      console.log(`leftPath is required because changeType is ${changeType}`, obj);
    }
    assert(!!obj.leftPath, 'leftPath is required');
  }

  const includeRight = ['changed', 'added'].includes(changeType);
  if (includeRight) {
    if (!obj.rightPath) {
      console.log(`rightPath is required because changeType is ${changeType}`, obj);
    }
    assert(!!obj.rightPath, 'rightPath is required');
  }

  return <div className="change-value">
    {includeLeft && <div className={getLeftClassName(obj)}>{toString(obj.leftPath as ObjectPath, left)}</div>}
    {includeRight && <div className={getRightClassName(obj)}>{toString(obj.rightPath as ObjectPath, right)}</div>}
  </div>;
}

function unBSON(value: any | any[]): any | any[] {
  if (Array.isArray(value)) {
    return value.map(unBSON);
  } else if (isSimpleObject(value)) {
    const mapped: Record<string, any|any[]> = {};
    for (const [k, v] of Object.entries(value)) {
      mapped[k] = unBSON(v);
    }
    return mapped;
  } else if (value?._bsontype) {
    return stringify(value);
  } else {
    return value;
  }
}

type LeftRightContextType = {
  left: any;
  right: any;
}

const LeftRightContext = createContext<LeftRightContextType | null>(null);

export function ChangeView({
  name,
  before,
  after
}: {
  name: string,
  before: Document,
  after: Document
}) {
  const left = unBSON(before);
  const right = unBSON(after);
  const delta = diffpatcher.diff(left, right) ?? null;
  console.log(delta);
  const obj: ObjectWithChange = {
    leftPath: [],
    leftValue: before,
    rightPath: [],
    rightValue: after,
    delta,
    implicitChangeType: 'unchanged',
    changeType: 'unchanged',
  };
  return <LeftRightContext.Provider value={{ left: before, right: after }}>
    <div className="change-view"><ChangeObject obj={obj} isOpen={true}/></div>
  </LeftRightContext.Provider>;
  //const html = jsondiffpatch.formatters.html.format(delta as Delta, before);
  //return <div className="change-view" dangerouslySetInnerHTML={{__html: html}} />
}