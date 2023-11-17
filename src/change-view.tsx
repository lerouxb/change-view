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
  }
});

type ObjectPath = (string | number)[];

function isSimpleObject(value: any) {
  return Object.prototype.toString.call(value) === '[object Object]' && !value._bsontype;
}

function stringify(value: any) {
  //console.log('stringify', value);
  // TODO: format ints, doubles, strings, other things properly
  return EJSON.stringify(value)
}

function pathToKey(path: ObjectPath) {
  const parts: string[] = [];
  for (const part of path) {
    if (typeof part === 'string') {
      parts.push(`["${part.replace(/"/g, '\\')}"]`);
    }
    else {
      parts.push(`[${part}]`);
    }
  }
  return parts.join('');
}

type ChangeType = 'unchanged'|'changed'|'added'|'removed';

type ObjectWithChange = {
  changeType: ChangeType;
  value: any | any[]; // arrays can be nested
  path: ObjectPath;
  delta: Delta | null;
};

type PropertyWithChange = ObjectWithChange & {
  objectKey: string;
};

function propertiesWithChanges({
  path,
  before,
  delta,
  changeType = 'unchanged'
}: {
  path: ObjectPath,
  before: Document | null,
  delta: Delta | null,
  changeType?: ChangeType
}) {
  if (!before) {
    // TODO: deal with adds
    return [];
  }

  const properties: PropertyWithChange[] = Object.entries(before).map(([objectKey, value]) => {
    const newPath = [...path, objectKey];
    const property = {
      changeType,
      objectKey,
      value,
      path: newPath,
      delta: null // TODO
    };
    // TODO: actually deal with the rest of the types
    return property;
  });

  return properties;
}

type ItemWithChange = ObjectWithChange & {
  index: number;
};

function itemsWithChanges({
  path,
  before,
  delta,
  changeType = 'unchanged'
}: {
  path: ObjectPath,
  before: any[] | null,
  delta: Delta | null,
  changeType?: ChangeType
}) {
  if (!before) {
    // TODO: deal with adds
    return [];
  }
  const items: ItemWithChange[] = before.map((value, index) => {
    const newPath = [...path, index];
    const item = {
      changeType,
      index,
      value,
      path: newPath,
      delta: null // TODO
    };
    // TODO: actually deal with the rest of the types
    return item;
  });
  return items;
}

function ChangeArrayItem({
  item,
  isLast
}: {
  item: ItemWithChange,
  isLast: boolean,
}) {
  // TODO: deal with nested arrays
  return (<div className="change-object-item">
    <div className="change-array-value">
      <ChangeLeaf obj={item} />
      {!isLast && <div className="change-array-separator">,</div>}
    </div>
  </div>);
}

function ChangeArray({
  // TODO: for nested arrays this should take item as well. or we need two components
  obj,
  isOpen
}: {
  obj: ObjectWithChange,
  isOpen: boolean
}) {
  //console.log('ChangeArray', before);
  // TODO: actually take delta into account
  const items = itemsWithChanges({
    path: obj.path,
    before: obj.value, // TODO: only if the value was changed, unchanged or removed. not for added
    delta: obj.delta,
    changeType: obj.changeType
  });
  if (isOpen) {
    return (<div className="change-array">
      {items.map((item) => {
        // TODO: delta is wrong
        const key = pathToKey(item.path);
        console.log(key);
        return <ChangeArrayItem key={key} item={item} isLast={item.index === item.value.length - 1}/>
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
  const [isOpen, setIsOpen] = useState(false);

  const toggleIsOpen = function () {
    setIsOpen(!isOpen);
  };

  const numKeys = Object.keys(property.value).length;
  const text = `Object (${numKeys})`;

  //console.log('ChangeObjectPropertyObject', objectKey, before);
  return (<div className="change-object-property change-object-property-object">
    <div className="change-object-property-summary">
      <button className="toggle-object-property" onClick={toggleIsOpen}>{isOpen ? '-' : '+'}</button>
      <div className="change-object-key">{property.objectKey}:</div>
      <div className="change-object-property-summary-text">{text}</div>
    </div>
    <ChangeObject obj={property} isOpen={isOpen}/>
  </div>);
}

function ChangeObjectPropertyArray({
  property
}: {
  property: PropertyWithChange
}) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleIsOpen = function () {
    setIsOpen(!isOpen);
  };

  const numItems = property.value.length;
  const text = `Array (${numItems})`;

  //console.log('ChangeObjectPropertyArray', objectKey, before);
  return (<div className="change-object-property change-object-property-array">
    <div className="change-object-property-summary">
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
    <div className="change-object-property-summary">
      <div className="change-object-key">{property.objectKey}:</div>
      <ChangeLeaf obj={property} />
    </div>
  </div>);
}

function ChangeObjectProperty({
  property
}: {
  property: PropertyWithChange
}) {

  if (Array.isArray(property.value)) {
    // array summary followed by array items if expanded
    return <ChangeObjectPropertyArray property={property} />
  } else if (isSimpleObject(property.value)) {
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
  //console.log('ChangeObject', before);

  // TODO: actually take delta into account
  const properties = propertiesWithChanges({
    path: obj.path,
    before: obj.value, // TODO: only if the value was changed, unchanged or removed. not for added
    delta: obj.delta,
    changeType: obj.changeType
  });
  if (isOpen) {
    return (<div className="change-object">
      {properties.map((property) => {
        // TODO: delta is wrong
        const key = pathToKey(property.path);
        console.log(key);
        return <ChangeObjectProperty key={key} property={property} />
      })}
    </div>);
  }

  return null
}

function ChangeLeaf({
  obj,
}: {
  obj: ObjectWithChange
}) {
  return <div className="change-value">{stringify(obj.value)}</div>;
}

function ChangeBranch({
  obj,
  isOpen = false
}: {
  obj: ObjectWithChange,
  isOpen?: boolean
}) {
  //console.log('ChangeBranch', before);
  if (Array.isArray(obj.value)) {
    //console.log('array', before);
    return <ChangeArray obj={obj} isOpen={isOpen} />
  } else if (isSimpleObject(obj.value)) {
    //console.log('object', before);
    return <ChangeObject obj={obj} isOpen={isOpen} />
  } else {
    // simple value or BSON value
    //console.log('simple', before);
    return <ChangeLeaf obj={obj} />
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
  const delta = diffpatcher.diff(before, after) ?? null;
  const obj: ObjectWithChange = {
    path: [name],
    value: before,
    delta,
    changeType: 'unchanged',
  };
  return <div className="change-view"><ChangeBranch obj={obj} isOpen={true}/></div>;
  //const html = jsondiffpatch.formatters.html.format(delta as Delta, before);
  //return <div className="change-view" dangerouslySetInnerHTML={{__html: html}} />
}