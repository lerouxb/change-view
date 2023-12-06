import React, { useState, useContext, createContext } from 'react';

import { BSONValue, Icon, css } from '@mongodb-js/compass-components';

import { type Document } from 'bson';

import {
  differ,
  propertiesWithChanges,
  itemsWithChanges
}  from './unified-document';
import type {
  ObjectPath,
  ObjectWithChange,
  PropertyWithChange,
  ItemWithChange,
  Branch,
  BranchesWithChanges
} from './unified-document';
import { stringifyBSON, unBSON, getType } from './bson-utils';
import { isSimpleObject, getValueShape} from './shape-utils'

import './change-view.css';

type LeftRightContextType = {
  left: any;
  right: any;
}

const expandButton = css({
  margin: 0,
  padding: 0,
  border: 'none',
  background: 'none',
  '&:hover': {
    cursor: 'pointer',
  },
  display: 'flex',
});

function getImplicitChangeType(obj: ObjectWithChange) {
  if (['added', 'removed'].includes(obj.implicitChangeType)) {
    // these are "sticky" as we descend
    return obj.implicitChangeType;
  }

  return obj.changeType;
}

function getObjectKey(obj: ObjectWithChange) {
  const path = (obj.right ?? obj.left).path;

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
      <button
        type="button"
        aria-pressed={isOpen}
        aria-label={isOpen ? 'Collapse field items' : 'Expand field items'}
        className={expandButton} onClick={toggleIsOpen}
      >
        <Icon
            size="xsmall"
            glyph={isOpen ? 'CaretDown' : 'CaretRight'}
          ></Icon>
      </button>
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
      <button
        type="button"
        aria-pressed={isOpen}
        aria-label={isOpen ? 'Collapse field items' : 'Expand field items'}
        className={expandButton} onClick={toggleIsOpen}
      >
        <Icon
            size="xsmall"
            glyph={isOpen ? 'CaretDown' : 'CaretRight'}
          ></Icon>
      </button>
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
  const value = item.changeType === 'added' ? item.right.value : item.left.value;
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
    left: obj.left ?? undefined,
    right: obj.right ?? undefined,
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
    if (items.every((item) => getValueShape(item.changeType === 'added' ? item.right.value : item.left.value) === 'leaf')) {
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
      <button
        type="button"
        aria-pressed={isOpen}
        aria-label={isOpen ? 'Collapse field items' : 'Expand field items'}
        className={expandButton} onClick={toggleIsOpen}
      >
        <Icon
            size="xsmall"
            glyph={isOpen ? 'CaretDown' : 'CaretRight'}
          ></Icon>
      </button>
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
      <button
        type="button"
        aria-pressed={isOpen}
        aria-label={isOpen ? 'Collapse field items' : 'Expand field items'}
        className={expandButton} onClick={toggleIsOpen}
      >
        <Icon
            size="xsmall"
            glyph={isOpen ? 'CaretDown' : 'CaretRight'}
          ></Icon>
      </button>
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
  const value = property.changeType === 'added' ? property.right.value : property.left.value;
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
    left: obj.left ?? undefined,
    right: obj.right ?? undefined,
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
  // all use emotion anyway.

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

  /*
  const toString = (path: ObjectPath, value: any) => {
    // Just prove that we can look up the value in the left/right data by path
    // and then display that rather than the un-BSON'd value we used when
    // diffing. Then stringify it for now anyway ;)
    const v = lookupValue(path, value);
    return stringifyBSON(v);
  };
  */

  const changeType = getChangeType(obj);
  // We could be showing the left value (unchanged, removed), right value
  // (added) or both (changed). Furthermore the left one could have no colour or
  // it could be red and the right one is always green.
  const includeLeft = ['unchanged', 'changed', 'removed'].includes(changeType);
  const includeRight = ['changed', 'added'].includes(changeType);

  // {includeLeft && <div className={getLeftClassName(obj)}>{toString((obj.left as Branch).path as ObjectPath, left)}</div>}
  // {includeRight && <div className={getRightClassName(obj)}>{toString((obj.right as Branch).path as ObjectPath, right)}</div>}

  const leftValue = includeLeft ? lookupValue((obj.left as Branch).path, left) : undefined;
  const rightValue = includeRight ? lookupValue((obj.right as Branch).path, right) : undefined;

  return <div className="change-value">
    {leftValue && <div className={getLeftClassName(obj)}>{<BSONValue type={getType(leftValue)} value={leftValue} />}</div>}
    {rightValue && <div className={getRightClassName(obj)}>{<BSONValue type={getType(rightValue)} value={rightValue} />}</div>}
  </div>;
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

  const delta = differ.diff(left, right) ?? null;
  console.log(delta);

  const obj: ObjectWithChange = {
    left: {
      path: [],
      value: before
    },
    right: {
      path: [],
      value: after
    },
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