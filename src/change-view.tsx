import React, { useState, useContext, createContext } from 'react';

import { BSONValue, Icon, css, cx, palette, spacing, fontFamilies, useDarkMode } from '@mongodb-js/compass-components';

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
  alignSelf: 'center'
});

const addedStylesDark = css({
  backgroundColor: palette.green.dark2
});

const addedStylesLight = css({
  backgroundColor: palette.green.light1
});

const removedStylesDark = css({
  backgroundColor: palette.red.dark3
});

const removedStylesLight = css({
  backgroundColor: palette.red.light2
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

const changeArrayItemStyles = css({
  display: 'flex',
  flexDirection: 'column',
  marginTop: '1px'
});


const changeKeyIndexStyles = css({
  fontWeight: 'bold',
  padding: '0 4px',
  alignSelf: 'flex-start'
});

const changeSummaryStyles = css({
  display: 'inline-flex',
  alignItems: 'flex-start'
});

function getChangeSummaryClass(obj: ObjectWithChange, darkMode?: boolean) {
  const changeType = getChangeType(obj);
  if (changeType === 'unchanged' || changeType === 'changed') {
    return undefined;
  }

  if (changeType === 'added') {
    return darkMode ? addedStylesDark : addedStylesLight;
  }
  else {
    return darkMode ? removedStylesDark : removedStylesLight;
  }
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

  const darkMode = useDarkMode();
  const summaryClass = getChangeSummaryClass(item, darkMode);

  return (<div className={changeArrayItemStyles}>
    <div className={changeSummaryStyles}>
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
      <div className={cx(changeKeyIndexStyles, summaryClass)}>{item.index}:</div>
      <div className={summaryClass}>{text}</div>
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

  const darkMode = useDarkMode();
  const summaryClass = getChangeSummaryClass(item, darkMode);

  return (<div className={changeArrayItemStyles}>
    <div className={changeSummaryStyles}>
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
      <div className={cx(changeKeyIndexStyles, summaryClass)}>{item.index}:</div>
      <div className={summaryClass}>{text}</div>
    </div>
    <ChangeObject obj={item} isOpen={isOpen} />
  </div>);
}

const changeLeafStyles = css({
  paddingLeft: '12px' /* line up with expand/collapse */
});

function ChangeArrayItemLeaf({
  item,
}: {
  item: ItemWithChange,
}) {

  const darkMode = useDarkMode();
  const summaryClass = getChangeSummaryClass(item, darkMode);

  return (<div className={cx(changeArrayItemStyles, changeLeafStyles)}>
    <div className={changeSummaryStyles}>
      <div className={cx(changeKeyIndexStyles, summaryClass)}>{item.index}:</div>
      <div className={summaryClass}><ChangeLeaf obj={item} /></div>
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

const sepStyles = css({
  marginRight: spacing[1]
})

function Sep() {
  return <span className={sepStyles}>, </span>;
}

const changeArrayStyles = css({
  display: 'flex',
  flexDirection: 'column',
  paddingLeft: '16px'
});

const changeArrayInlineWrapStyles = css({
  marginTop: '1px' // don't touch the previous item
});

const changeArrayInlineStyles = css({
  marginLeft: '28px',
  display: 'inline-flex', /* so the green/red background colour doesn't stretch all the way to the end */
  flexWrap: 'wrap'
});

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
      const classes = [changeArrayInlineStyles];

      if (implicitChangeType === 'added') {
        classes.push('change-array-inline-added');
      }

      if (implicitChangeType === 'removed') {
        classes.push('change-array-inline-removed');
      }

      return (<div className={changeArrayInlineWrapStyles}><div className={cx(...classes)}>[
        {items.map((item, index) => {
          const key = getObjectKey(item);
          return <div className="change-array-inline-element" key={key}>
            <ChangeLeaf obj={item} />
            {index !== items.length -1 && <Sep/>}
          </div>
        })}
      ]</div></div>)
    }

    return (<div className={changeArrayStyles}>
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

  const darkMode = useDarkMode();
  const summaryClass = getChangeSummaryClass(property, darkMode);

  return (<div className={changeObjectPropertyStyles}>
    <div className={changeSummaryStyles}>
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
      <div className={cx(changeKeyIndexStyles, summaryClass)}>{property.objectKey}:</div>
      <div className={summaryClass}>{text}</div>
    </div>
    <ChangeObject obj={property} isOpen={isOpen} />
  </div>);
}

const changeObjectPropertyStyles = css({
  display: 'flex',
  flexDirection: 'column',
  marginTop: '1px' // stop the red/green blocks touching
});

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

  const darkMode = useDarkMode();
  const summaryClass = getChangeSummaryClass(property, darkMode);

  return (<div className={changeObjectPropertyStyles}>
    <div className={changeSummaryStyles}>
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
      <div className={cx(changeKeyIndexStyles, summaryClass)}>{property.objectKey}:</div>
      <div className={summaryClass}>{text}</div>
    </div>
    <ChangeArray obj={property} isOpen={isOpen}/>
  </div>);
}

function ChangeObjectPropertyLeaf({
  property
}: {
  property: PropertyWithChange
}) {
  const darkMode = useDarkMode();
  const summaryClass = getChangeSummaryClass(property, darkMode);

  return (<div className={cx(changeObjectPropertyStyles, changeLeafStyles)}>
    <div className={changeSummaryStyles}>
      <div className={cx(changeKeyIndexStyles, summaryClass)}>{property.objectKey}:</div>
      <div className={summaryClass}><ChangeLeaf obj={property} /></div>
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

const changeObjectStyles = css({
  display: 'flex',
  flexDirection: 'column',
  paddingLeft: '16px' /* indent all nested properties*/
})

const rootChangeObjectStyles = css({
  // don't indent the top-level object
  paddingLeft: 0
});

function ChangeObject({
  obj,
  isOpen,
  isRoot
}: {
  obj: ObjectWithChange,
  isOpen: boolean,
  isRoot?: boolean
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
    return (<div className={cx(changeObjectStyles, isRoot && rootChangeObjectStyles)}>
      {properties.map((property) => {
        const key = getObjectKey(property);
        return <ChangeObjectProperty key={key} property={property} />
      })}
    </div>);
  }

  return null;
}

function getLeftClassName(obj: ObjectWithChange, darkMode?: boolean) {
  const addedClass = darkMode ? addedStylesDark : addedStylesLight;
  const removedClass = darkMode ? removedStylesDark : removedStylesLight;

  if (obj.implicitChangeType === 'removed') {
    return removedClass;
  }

  if (obj.implicitChangeType === 'added') {
    return addedClass;
  }

  if (obj.changeType === 'unchanged') {
    return undefined;
  }

  if (obj.changeType === 'removed') {
    return removedClass;
  }

  return obj.changeType === 'changed' ? removedClass : addedClass;
}

function getRightClassName(obj: ObjectWithChange, darkMode?: boolean) {
  return darkMode ? addedStylesDark : addedStylesLight;
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

const changeValueStyles = css({
  display: 'inline-flex',
  flexWrap: 'wrap',
  columnGap: '4px', // when removed and added are next to each other
  rowGap: '1px' // when removed & added wrapped
});

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

  const darkMode = useDarkMode();

  // {includeLeft && <div className={getLeftClassName(obj, darkMode)}>{toString((obj.left as Branch).path as ObjectPath, left)}</div>}
  // {includeRight && <div className={getRightClassName(obj, darkMode)}>{toString((obj.right as Branch).path as ObjectPath, right)}</div>}

  const leftValue = includeLeft ? lookupValue((obj.left as Branch).path, left) : undefined;
  const rightValue = includeRight ? lookupValue((obj.right as Branch).path, right) : undefined;

  // TODO: BSONValue does not deal with `null`
  // TODO: BSONValue does not always show the bson type, so you can't spot bson type changes
  return <div className={changeValueStyles}>
    {includeLeft && <div className={getLeftClassName(obj, darkMode)}>{<BSONValue type={getType(leftValue)} value={leftValue} />}</div>}
    {includeRight && <div className={getRightClassName(obj, darkMode)}>{<BSONValue type={getType(rightValue)} value={rightValue} />}</div>}
  </div>;
}

const LeftRightContext = createContext<LeftRightContextType | null>(null);

const changeViewStyles = css({
  overflow: 'auto',
  fontFamily: fontFamilies.code,
  fontSize: '12px',
  lineHeight: '16px',
});

const changeViewStylesDark = css({
  color: palette.gray.light2
});

const changeViewStylesLight = css({
  color: palette.gray.dark2
});

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

  const darkMode = useDarkMode();

  // Keep the left and right values in context so that the ChangeLeaf component
  // can easily find them again to lookup the original BSON values. Otherwise
  // we'd have to pass references down through every component.
  return <LeftRightContext.Provider value={{ left: before, right: after }}>
    <div className={cx(changeViewStyles, darkMode ? changeViewStylesDark : changeViewStylesLight)} data-testid={`change-view-{${name}}`}><ChangeObject obj={obj} isOpen={true} isRoot={true}/></div>
  </LeftRightContext.Provider>;
}