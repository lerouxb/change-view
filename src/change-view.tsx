import _ from 'lodash';
import React, { useState } from 'react';

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
  objectHash: function (obj: any) {
    return stringify(obj);
  },
  textDiff: {
    minLength: Infinity
  },
  cloneDiffValues: true
});

type ObjectPath = (string | number)[];

function isSimpleObject(value: any) {
  return Object.prototype.toString.call(value) === '[object Object]' && !value._bsontype;
}

function stringify(value: any) {
  if (typeof value === 'string') {
    return value;
  }

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
  oldValue?: any | any[];
  newValue?: any | any[];
  path: ObjectPath;
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

/*
function deBSON(properties: PropertyWithChange[], key: string, change: any) {
  if (Array.isArray(change)) {
    // only non-bson add/update involved
    return change;
  }

  const existingProperty = properties.find((p) => p.objectKey === key);
  if (existingProperty && existingProperty.oldValue._bsontype) {
    if (key === 'binData') {
      console.log(key, existingProperty.oldValue, change);
    }
    const newValue = _.clone(existingProperty.oldValue);
    jsondiffpatch.patch(newValue, change);
    return [existingProperty.oldValue, newValue];
  }

  return change;
}
*/

function propertiesWithChanges({
  path,
  before,
  delta,
  implicitChangeType = 'unchanged'
}: {
  path: ObjectPath,
  before: Document | null,
  delta: Delta | null,
  implicitChangeType?: ChangeType
}) {
  if (!before) {
    // you can't actually get here because we'd be treating this as an
    // implicitChangeType='added' and changeType='unchanged'
    assert(false, 'no before properties');
    return [];
  }

  const properties: PropertyWithChange[] = Object.entries(before).map(([objectKey, oldValue]) => {
    const newPath = [...path, objectKey];
    const property: PropertyWithChange = {
      implicitChangeType,
      changeType: 'unchanged',
      objectKey,
      oldValue,
      path: newPath,
      delta: null // see below
    };
    return property;
  });

  if (delta) {
    assert(isSimpleObject(delta), 'delta should be a simple object');
    for (const [key, change] of Object.entries(delta)) {
      /*
      delta = {
        property1: [ newValue1 ], // obj[property1] = newValue1
        property2: [ oldValue2, newValue2 ], // obj[property2] = newValue2 (and previous value was oldValue2)
        property5: [ oldValue5, 0, 0 ] // delete obj[property5] (and previous value was oldValue5)
      }
      */
      if (Array.isArray(change)) {
        if (change.length === 1) {
          // add
          properties.push({
            implicitChangeType,
            changeType: 'added',
            objectKey: key,
            newValue: change[0],
            path: [...path, key],
            delta: null
          });
        } else if (change.length === 2) {
          // update
          const existingProperty = properties.find((p) => p.objectKey === key);
          if (existingProperty) {
            existingProperty.newValue = change[1]; // 0 is the old value
            existingProperty.changeType = 'changed';
          } else {
            assert(false, `property with key "${key} does not exist"`);
          }
        } else if (change.length === 3) {
          // delete
          const existingProperty = properties.find((p) => p.objectKey === key);
          if (existingProperty) {
            existingProperty.changeType = 'removed';
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
        const beforeType = getType(property.oldValue);
        const afterType = getType(property.newValue);
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
        oldValue: property.oldValue,
        path: property.path,
        delta: null
      };

      const addProperty: PropertyWithChange = {
        implicitChangeType,
        changeType: 'added',
        objectKey: property.objectKey,
        newValue: property.newValue,
        path: property.path,
        delta: null
      };
      properties.splice(index, 1, deleteProperty, addProperty);
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
  path,
  before,
  delta,
  implicitChangeType = 'unchanged'
}: {
  path: ObjectPath,
  before: any[] | null,
  delta: Delta | null,
  implicitChangeType?: ChangeType
}) {
  if (!before) {
    // you can't actually get here because we'd be treating this as an
    // implicitChangeType='added' and changeType='unchanged'
    console.log('no before items', {path, before, delta, implicitChangeType});
    return [];
  }
  const items: ItemWithChange[] = before.map((oldValue, index) => {
    const newPath = [...path, index];
    const item: ItemWithChange = {
      implicitChangeType: implicitChangeType,
      changeType: 'unchanged',
      index,
      oldValue,
      path: newPath,
      delta: null, // see below
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
            newValue: change[0],
            path: [...path, index],
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
  let changed = true;
  while (changed) {
    changed = false;
    const index = items.findIndex((item) => {
      if (item.changeType === 'changed') {
        const beforeType = getType(item.oldValue);
        const afterType = getType(item.newValue);
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
        oldValue: property.oldValue,
        path: property.path,
        delta: null
      };

      const addItem: ItemWithChange = {
        implicitChangeType,
        changeType: 'added',
        index: property.index,
        newValue: property.newValue,
        path: property.path,
        delta: null
      };
      items.splice(index, 1, deleteItem, addItem);
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

  //const value = item.changeType === 'added' ? item.newValue : item.oldValue;
  //const numItems = value.length;
  //const text = `Array (${numItems})`;
  const text = 'Array';

  return (<div className="change-array-item change-array-item-array">
    <div className={`change-array-item-summary change-summary-${getSummaryClassName(item)}`}>
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

  //const value = item.changeType === 'added' ? item.newValue : item.oldValue;
  //const numKeys = Object.keys(value).length;
  //const text = `Object (${numKeys})`;
  const text = 'Object';

  return (<div className="change-array-item change-array-item-object">
    <div className={`change-array-item-summary change-summary-${getSummaryClassName(item)}`}>
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
    <div className={`change-array-item-summary change-summary-${getSummaryClassName(item)}`}>
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
  const value = item.changeType === 'added' ? item.newValue : item.oldValue;
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
    path: obj.path,
    before: obj.changeType === 'added' ? obj.newValue : obj.oldValue,
    delta: obj.delta,
    implicitChangeType
  });

  if (isOpen) {
    // TODO: this would be even nicer in place of the "Array" text and then we
    // don't even have to make the object key expandable or not, but that
    // requires itemsWithChanges() being called one level up

    // TODO: we might want to go further and only do this for simple values like
    // strings, numbers, booleans, nulls, etc. ie. not bson types because some
    // of those might  take up a lot of space?
    if (items.every((item) => getType(item.changeType === 'added' ? item.newValue : item.oldValue) === 'leaf')) {
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
          const key = pathToKey(item.path, item.changeType);
          return <span key={key}>
            <ChangeLeaf obj={item} />
            {index !== items.length -1 && <Sep/>}
          </span>
        })}
      ]</div></div>)
    }

    return (<div className="change-array">
      {items.map((item) => {
        const key = pathToKey(item.path, item.changeType);
        return <ChangeArrayItem key={key} item={item}/>
      })}
    </div>);
  }

  //return <CollapsedItems path={path} type="array" expand={expand} />;
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

  //const value = property.changeType === 'added' ? property.newValue : property.oldValue;
  //const numKeys = Object.keys(value).length;
  //const text = `Object (${numKeys})`;
  const text = 'Object';

  return (<div className="change-object-property change-object-property-object">
    <div className={`change-object-property-summary change-summary-${getSummaryClassName(property)}`}>
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

  //const value = property.changeType === 'added' ? property.newValue : property.oldValue;
  //const numItems = value.length;
  //const text = `Array (${numItems})`;
  const text = 'Array';

  return (<div className="change-object-property change-object-property-array">
    <div className={`change-object-property-summary change-summary-${getSummaryClassName(property)}`}>
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
    <div className={`change-object-property-summary change-summary-${getSummaryClassName(property)}`}>
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
  const value = property.changeType === 'added' ? property.newValue : property.oldValue;
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

  const properties = propertiesWithChanges({
    path: obj.path,
    before: obj.changeType === 'added' ? obj.newValue : obj.oldValue,
    delta: obj.delta,
    implicitChangeType: getImplicitChangeType(obj)
  });
  if (isOpen) {
    return (<div className="change-object">
      {properties.map((property) => {
        const key = pathToKey(property.path, property.changeType);
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

function getSummaryClassName(obj: ObjectWithChange) {
  if (['added', 'removed'].includes(obj.implicitChangeType)) {
    // these are "sticky" as we descend
    return obj.implicitChangeType;
  }

  return obj.changeType;
}

function ChangeLeaf({
  obj,
}: {
  obj: ObjectWithChange
}) {
  // Anything that is not an object or array. This includes simple javascript
  // values like strings, numbers, booleans and undefineds, but also dates or
  // bson values.
  const oldValue = stringify(obj.oldValue);
  const includeLeft = ['unchanged', 'changed', 'removed'].includes(obj.changeType);
  const includeRight = ['changed', 'added'].includes(obj.changeType);

  return <div className="change-value">
    {includeLeft && <div className={getLeftClassName(obj)}>{oldValue}</div>}
    {includeRight && <div className={getRightClassName(obj)}>{stringify(obj.newValue)}</div>}
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
    path: [name],
    oldValue: before,
    delta,
    implicitChangeType: 'unchanged',
    changeType: 'unchanged',
  };
  return <div className="change-view"><ChangeObject obj={obj} isOpen={true}/></div>;
  //const html = jsondiffpatch.formatters.html.format(delta as Delta, before);
  //return <div className="change-view" dangerouslySetInnerHTML={{__html: html}} />
}