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
    // Array moves are really complicated to visualise both technically and also
    // usability-wise. (see jsondiffpatch's demo). With this set to false array
    // changes will be separate removes and adds.
    detectMove: false
  },
  textDiff: {
    // TODO: technically this doesn't matter anymore now that we look up the
    // value out of before/after docs, but there are nicer ways to diff larger
    // blocks of text. Although we probably won't bother with diffing text
    // fields for our use case.
    minLength: Infinity // don't do a text diff on bson values
  },
  objectHash: function (obj: any) {
    // Probably not the most efficient, but gets the job done. This is used by
    // jsondiffpatch when diffing arrays that contain objects to be able to
    // determine which objects in the left and right docs are the same ones.
    return stringify(obj);
  }
});

type ObjectPath = (string | number)[];

type LeftRightContextType = {
  left: any;
  right: any;
}

type ChangeType = 'unchanged'|'changed'|'added'|'removed';

type ObjectWithChange = {
  implicitChangeType: ChangeType;
  changeType: ChangeType;
  // TODO: use left and right Branch rather than leftPath, leftValue, rightPath,
  // rightValue. ie. rather use the type system than fight it..
  leftPath?: ObjectPath;
  leftValue?: any | any[];
  rightPath?: ObjectPath;
  rightValue?: any | any[];
  delta: Delta | null;
};

type PropertyWithChange = ObjectWithChange & {
  objectKey: string;
};

type ItemWithChange = ObjectWithChange & {
  index: number;
};

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

function getImplicitChangeType(obj: ObjectWithChange) {
  if (['added', 'removed'].includes(obj.implicitChangeType)) {
    // these are "sticky" as we descend
    return obj.implicitChangeType;
  }

  return obj.changeType;
}

function isSimpleObject(value: any) {
  return Object.prototype.toString.call(value) === '[object Object]' && !value._bsontype;
}

function stringify(value: any) {
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

// TODO: just use node's assert module
function assert(bool: boolean, message: string) {
  if (!bool) {
    throw new Error(message);
  }
}

function getValueShape(value: any) {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (isSimpleObject(value)) {
    return 'object';
  }
  return 'leaf';
}

function propertiesWithChanges({
  left,
  right,
  delta,
  implicitChangeType
}: BranchesWithChanges) {
  // For unchanged, changed or removed objects we use the left value, otherwise
  // we use the right value because that's the only one available. ie. we
  // descend down a branch of green added stuff and render that even though
  // there's no "left/before" data matching it. For red removed branches we
  // still use the left/before data.
  const value = implicitChangeType === 'added' ? right.value : left.value;

  const properties: PropertyWithChange[] = Object.entries(value).map(([objectKey, leftValue]) => {
    // For both of these: if there is a left/right path we use that. Otherwise
    // we're in an added/removed branch so there is no corresponding left/right
    // path. (So you can have left or right or both)
    const leftPath = left ? [...left.path as ObjectPath, objectKey] : undefined;
    const rightPath = right ? [...right.path as ObjectPath, objectKey] : undefined;

    const property: PropertyWithChange = {
      implicitChangeType,
      // Start off assuming the value is unchanged, then we might change
      // changeType to 'changed' or 'removed' below.
      changeType: 'unchanged',
      objectKey,
      leftPath,
      leftValue: leftPath ? leftValue : undefined,
      // For rightPath and rightValue this is just the case where the value was
      // unchanged. changed, added and removed get handled below, overriding
      // these values.
      rightPath,
      rightValue: rightPath ? right.value[objectKey] : undefined,
      // We'll fill in delta below if this is an unchanged object with changes
      // somewhere inside it.
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
            // This assignment might be pointless because we already initialised
            // the property with the right value above, but just keep it for
            // completeness' sake.
            existingProperty.rightValue = change[1]; // 0 is the old (left) value
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
        // unchanged, so we pass the delta along as there are changes deeper in
        // the branch
        const existingProperty = properties.find((p) => p.objectKey === key);
        if (existingProperty) {
          existingProperty.delta = change;
        } else {
          assert(false, `property with key "${key} does not exist"`);
        }
      }
    }
  }

  // Turn changes where the "shape" (ie. array, object or leaf) changed into
  // remove followed by add because we can't easily visualise it on one line
  // TODO: we might be able to roll this in above and not need a separate pass
  let changed = true;
  while (changed) {
    changed = false;
    const index = properties.findIndex((property) => {
      if (property.changeType === 'changed') {
        const beforeType = getValueShape(property.leftValue);
        const afterType = getValueShape(property.rightValue);
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

  // TODO: this is temporary and should be in tests plus proper usage of types,
  // not at runtime.
  for (const property of properties) {
    if (property.leftPath && property.leftValue === undefined) {
      assert(false, 'property: leftPath, but no leftValue')
    }

    if (property.rightPath && property.rightValue === undefined) {
      assert(false, 'property: rightPath, but no rightValue')
    }

    if (property.leftValue !== undefined && !property.leftPath) {
      assert(false, 'property: leftValue, but no leftPath')
    }

    if (property.rightValue !== undefined && !property.rightPath) {
      assert(false, 'property: rightValue, but no rightPath')
    }
  }

  return properties;
}

function itemsWithChanges({
  left,
  right,
  delta,
  implicitChangeType
}: BranchesWithChanges) {
  // Same reasoning here as for propertiesWithChanges
  const value = (implicitChangeType === 'added' ? right.value : left.value) as any[];

  const items: ItemWithChange[] = value.map((leftValue, index) => {
    // Same thing here as for propertiesWithChanges
    const leftPath = left ? [...left.path as ObjectPath, index] : undefined;
    const rightPath = right ? [...right.path as ObjectPath, index] : undefined;

    const item: ItemWithChange = {
      implicitChangeType,
      // we might change changeType to 'removed' below. arrays don't have
      // 'changed'. Only unchanged, added or removed.
      changeType: 'unchanged',
      index,
      leftPath,
      leftValue: leftPath ? leftValue : undefined,
      // same as for propertiesWithChanges we start by assuming the value is
      // unchanged and then we might remove rightPath and rightValue again below
      rightPath,
      rightValue: rightPath ? leftValue : undefined,
      // Array changes don't work like object changes where it is possible for a
      // property to have changes that are deeper down. All changes are adds or
      // removes, so no delta to pass down to lower levels.
      delta: null
    };
    return item;
  });

  if (delta) {
    /*
    delta = {
      _t: 'a',
      index1: innerDelta1,
      index2: innerDelta2,
      index5: innerDelta5,
    };
    */
    assert(delta._t === 'a', 'delta._t is not a');
    const toRemove = Object.keys(delta)
      .filter((key) => key.startsWith('_') && key !== '_t')
      .map((key) => key.slice(1) as unknown as number);

    // Removed indexes refer to the original (left) which is why we remove in a
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
        // Non-removed indexes refer to the final (right) array which is why we
        // update/add in a separate pass after removing

        const index = _index as unknown as number;
        assert(Array.isArray(change), 'unexpected non-array');
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

function getObjectKey(obj: ObjectWithChange) {
  const path = (obj.rightPath ?? obj.leftPath) as ObjectPath;

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
  return parts.join('')+'_'+obj.changeType;
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
    // of those might take up a lot of space?
    if (items.every((item) => getValueShape(item.changeType === 'added' ? item.rightValue : item.leftValue) === 'leaf')) {
      // if it is an array containing just leaf values then we can special-case it and output it all on one line
      const classes = ['change-array-inline'];

      if (implicitChangeType === 'added') {
        classes.push('change-array-inline-added');
      }

      if (implicitChangeType === 'removed') {
        classes.push('change-array-inline-removed');
      }

      return (<div className="change-array-inline-wrap"><div className={classes.join(' ')}>[
        {items.map((item, index) => {
          const key = getObjectKey(item);
          return <div className="change-array-inline-element" key={key}>
            <ChangeLeaf obj={item} />
            {index !== items.length -1 && <Sep/>}
          </div>
        })}
      ]</div></div>)
    }

    return (<div className="change-array">
      {items.map((item) => {
        const key = getObjectKey(item);
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
        const key = getObjectKey(property);
        return <ChangeObjectProperty key={key} property={property} />
      })}
    </div>);
  }

  return null
}

function getLeftClassName(obj: ObjectWithChange) {
  // TODO: This is a complete mess and has to be rewritten. The styling should
  // should all use emotion anyway.

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
  // TODO: I can't remember why I made it possible for obj.changeType to be
  // different from obj.implicitChangeType. Once a branch is added then
  // everything below that is also added, right? Might have been some styling
  // aid..
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
    // Just prove that we can look up the value in the left/right data by path
    // and then display that rather than the un-BSON'd value we used when
    // diffing. Then stringify it for now anyway ;)
    const v = lookupValue(path, value);
    return stringify(v);
  };

  const changeType = getChangeType(obj);
  // We could be showing the left value (unchanged, removed), right value
  // (added) or both (changed). Furthermore the left one could have no colour or
  // it could be red and the right one is always green.
  const includeLeft = ['unchanged', 'changed', 'removed'].includes(changeType);
  const includeRight = ['changed', 'added'].includes(changeType);

  // TODO: This should be handled by proper typing, not runtime checks
  if (includeLeft) {
    if (!obj.leftPath) {
      console.log(`leftPath is required because changeType is ${changeType}`, obj);
    }
    assert(!!obj.leftPath, 'leftPath is required');
  }
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
  // The idea here is to format BSON leaf values as text (shell syntax) so that
  // jsondiffpatch can easily diff them. Because we calculate the left and right
  // path for every value we can easily look up the BSON leaf value again and
  // use that when displaying if we choose to.
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

  // Keep the left and right values in context so that the ChangeLeaf component
  // can easily find them again to lookup the original BSON values. Otherwise
  // we'd have to pass references down through every component.
  return <LeftRightContext.Provider value={{ left: before, right: after }}>
    <div className="change-view" data-testid={`change-view-{${name}}`}><ChangeObject obj={obj} isOpen={true}/></div>
  </LeftRightContext.Provider>;
}