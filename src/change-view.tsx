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

function isSimpleObject(value: any) {
  return Object.prototype.toString.call(value) === '[object Object]' && !value._bsontype;
}

function stringify(value: any) {
  console.log('stringify', value);
  // TODO: format ints, doubles, strings, other things properly
  return EJSON.stringify(value)
}

type ObjectPath = (string | number)[];

function CollapsedItems({
  type,
  expand
}: {
  path: ObjectPath,
  type: 'array' | 'object',
  expand: () => void
}) {
  return (<div className="collapsed-items">
    <div className="bracket open-bracket">{type === 'array' ? '[' : '{'}</div>
    <button onClick={expand} className="ellipses">⋯</button>
    <div className="bracket close-bracket">{type === 'array' ? ']' : '}'}</div>
  </div>);
}

function ExpandedItems({
  type,
  children,
  collapse,
  collapsible
}: {
  path: ObjectPath,
  type: 'array' | 'object',
  children: React.ReactNode,
  collapse: () => void
  collapsible: boolean
}) {
  return (<div className="expanded-items">
    <div className="expanded-opening-line">
      <div className="bracket open-bracket">{type === 'array' ? '[' : '{'}</div>
      {collapsible && <button onClick={collapse} className="collapse-button">-</button>}
    </div>
    <div className="collapsible-children">{children}</div>
    <div className="bracket close-bracket">{type === 'array' ? ']' : '}'}</div>
  </div>);
}

function ChangeArrayItem({
  path,
  before,
  delta,
  isLast
}: {
  path: ObjectPath,
  before: any | any[],
  delta: Delta,
  isLast: boolean,
}) {
  return (<div className="change-object-item">
    <div className="change-array-value">
      <ChangeBranch path={path} before={before} delta={delta}/>
      {!isLast && <div className="change-array-separator">,</div>}
    </div>
  </div>);
}

function ChangeArray({
  path,
  before,
  delta,
  initialOpen
}: {
  path: ObjectPath,
  before: any[],
  delta: Delta,
  initialOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(initialOpen ?? false);

  function collapse() {
    setIsOpen(false);
  }

  function expand() {
    setIsOpen(true);
  }

  //console.log('ChangeArray', before);
  // TODO: actually take delta into account
  if (isOpen) {
    return (<ExpandedItems path={path} type="array" collapse={collapse} collapsible={!initialOpen}>
      {before.map((value: any, index: number) => {
        // TODO: delta is wrong
        return <ChangeArrayItem path={[...path, index]} delta={delta} before={value} isLast={index === before.length - 1} />
      })}
    </ExpandedItems>);
  }

  return <CollapsedItems path={path} type="array" expand={expand} />;
  /*

      return <>
        <ChangeBranch path={[...path, index]} delta={delta} before={value} />
        {(index !== before.length-1) && <span className="change-array-separator">,</span>}
      </>;
    */
}

function ChangeObjectProperty({
  path,
  objectKey,
  before,
  delta,
}: {
  path: ObjectPath,
  objectKey: string,
  before: any | any[],
  delta: Delta,
}) {
  //console.log('ChangeObjectProperty', objectKey, before);
  return (<div className="change-object-property">
    <div className="change-object-key">{objectKey}:</div>
    <div className="change-object-value">
      <ChangeBranch path={path} before={before} delta={delta}/>
    </div>
  </div>);
}

function ChangeObject({
  path,
  before,
  delta,
  initialOpen
}: {
  path: ObjectPath,
  before: Document,
  delta: Delta,
  initialOpen?: boolean
}) {
  //console.log('ChangeObject', before);

  const [isOpen, setIsOpen] = useState(initialOpen ?? false);

  function collapse() {
    setIsOpen(false);
  }

  function expand() {
    setIsOpen(true);
  }

  // TODO: actually take delta into account
  if (isOpen) {
    return (<ExpandedItems path={path} type="object" collapse={collapse} collapsible={!initialOpen}>
      {Object.entries(before).map(([key, value]: [string, any]) => {
        // TODO: delta is wrong
        return <ChangeObjectProperty path={[...path, key]} delta={delta} objectKey={key} before={value} />
      })}
    </ExpandedItems>);
  }

  return <CollapsedItems path={path} type="object" expand={expand} />;
}

function ChangeBranch({
  path,
  before,
  //after,
  delta,
  initialOpen
}: {
  path: ObjectPath,
  before: Document | any[],
  //after: Document | any[]
  delta: Delta,
  initialOpen?: boolean
}) {
  //console.log('ChangeBranch', before);
  if (Array.isArray(before)) {
    console.log('array', before);
    return <ChangeArray path={path} before={before} delta={delta} initialOpen={initialOpen} />
  } else if (isSimpleObject(before)) {
    console.log('object', before);
    return <ChangeObject path={path} before={before} delta={delta} initialOpen={initialOpen} />
  } else {
    // simple value or BSON value
    console.log('simple', before);
    // TODO
    return <div className="change-value">{stringify(before)}</div>;
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
  const delta = diffpatcher.diff(before, after);
  if (!delta) {
    return null;
  }
  return <div className="change-view"><ChangeBranch path={[name]} delta={delta} before={before} initialOpen={true}/></div>;
  //const html = jsondiffpatch.formatters.html.format(delta as Delta, before);
  //return <div className="change-view" dangerouslySetInnerHTML={{__html: html}} />
}