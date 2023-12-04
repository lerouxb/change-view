import type { Delta } from 'jsondiffpatch';
import jsondiffpatch from 'jsondiffpatch';

import { stringifyBSON } from './bson-utils';
import { isSimpleObject, getValueShape } from './shape-utils';

export const differ = jsondiffpatch.create({
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
    return stringifyBSON(obj);
  }
});

export type ObjectPath = (string | number)[];

type ChangeType = 'unchanged'|'changed'|'added'|'removed';

export type ObjectWithChange = {
  implicitChangeType: ChangeType;
  delta: Delta | null;
} & (
  | { left: Branch, right: Branch, changeType: 'changed'|'unchanged' }
  | { left?: never, right: Branch, changeType: 'added' }
  | { left: Branch, right?: never, changeType: 'removed' }
);

export type PropertyWithChange = ObjectWithChange & {
  objectKey: string;
};

export type ItemWithChange = ObjectWithChange & {
  index: number;
};

export type Branch = {
  path: ObjectPath;
  value: any | any[];
};

export type BranchesWithChanges = {
  delta: Delta | null, // delta is null for unchanged branches
  implicitChangeType: ChangeType
} & (
  | { left: Branch, right: Branch } // changed | unchanged
  | { left?: never, right: Branch } // added
  | { left: Branch, right?: never } // removed
);

// TODO: just use node's assert module
function assert(bool: boolean, message: string) {
  if (!bool) {
    throw new Error(message);
  }
}


export function propertiesWithChanges({
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
  const value = implicitChangeType === 'added' ? (right as Branch).value : (left as Branch).value;

  const properties: PropertyWithChange[] = Object.entries(value).map(([objectKey, leftValue]): PropertyWithChange => {
    const prop: Omit<PropertyWithChange, 'left' | 'right' | 'changeType'>  ={
      implicitChangeType,
      objectKey,
      // We'll fill in delta below if this is an unchanged object with changes
      // somewhere inside it.
      // ie. { foo: {} } => foo: { bar: 'baz' }. foo's value is "unchanged"
      // itself, but it has a delta because bar inside it changed.
      delta: null
    };

    // For both of these: if there is a left/right path we use that. Otherwise
    // we're in an added/removed branch so there is no corresponding left/right
    // path. (So you can have left or right or both)
    const newLeft: Branch|undefined = left ? {
      path: [...left.path, objectKey],
      value: leftValue
    } : undefined;

    // This is just the case where the value was unchanged. changed, added and
    // removed get handled below, overriding these values.
    const newRight: Branch|undefined = right ? {
      path: [...right.path, objectKey],
      value: right.value[objectKey]
    } : undefined;

    if (newLeft && newRight) {
      return {
        ...prop,
        changeType: 'unchanged', // might change to changed below
        left: newLeft,
        right: newRight
      };
    } else if (newLeft) {
      return {
        ...prop,
        changeType: 'removed',
        left: newLeft,
      };
    } else if (newRight) {
      return {
        ...prop,
        changeType: 'added',
        right: newRight
      };
    } else {
      throw new Error('left or right required or both');
    }
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
            right: {
              path: [...(right as Branch).path, key], // right must exist because we're adding
              value: change[0],
            },
            delta: null
          } as PropertyWithChange);
        } else if (change.length === 2) {
          // update
          const existingProperty = properties.find((p) => p.objectKey === key);
          if (existingProperty) {
            // This assignment might be pointless because we already initialised
            // the property with the right value above, but just keep it for
            // completeness' sake.
            // 0 is the old (left) value, 1 is the new (right) value
            (existingProperty.right as Branch).value = change[1]; // right must exist because this is a change
            existingProperty.changeType = 'changed';
          } else {
            assert(false, `property with key "${key} does not exist"`);
          }
        } else if (change.length === 3) {
          // delete
          const existingProperty = properties.find((p) => p.objectKey === key);
          if (existingProperty) {
            existingProperty.changeType = 'removed';
            delete existingProperty.right;
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
        const beforeType = getValueShape(property.left.value);
        const afterType = getValueShape(property.right.value);
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
        left: property.left as Branch,
        delta: null
      };

      const addProperty: PropertyWithChange = {
        implicitChangeType,
        changeType: 'added',
        objectKey: property.objectKey,
        right: {
          // both exist because we just checked it above
          path: (property.left as Branch).path,
          value: (property.right as Branch).value
        },
        delta: null
      };
      properties.splice(index, 1, deleteProperty, addProperty);
    }
  }

  return properties;
}

export function itemsWithChanges({
  left,
  right,
  delta,
  implicitChangeType
}: BranchesWithChanges) {
  // Same reasoning here as for propertiesWithChanges
  const value = (implicitChangeType === 'added' ? (right as Branch).value : (left as Branch).value) as any[];

  const items: ItemWithChange[] = value.map((leftValue, index): ItemWithChange => {
    const item: Omit<ItemWithChange, 'left' | 'right' | 'changeType'>  = {
      implicitChangeType,
      index,
      // Array changes don't work like object changes where it is possible for a
      // property to have changes that are deeper down. All changes are adds or
      // removes, so no delta to pass down to lower levels.
      delta: null
    };

    // For both of these: if there is a left/right path we use that. Otherwise
    // we're in an added/removed branch so there is no corresponding left/right
    // path. (So you can have left or right or both)
    const newLeft: Branch|undefined = left ? {
      path: [...left.path, index],
      value: leftValue
    } : undefined;

    // This is just the case where the value was unchanged. changed, added and
    // removed get handled below, overriding these values.
    const newRight: Branch|undefined = right ? {
      path: [...right.path, index],
      // assume the value is unchanged, fix below if it was removed. Arrays
      // don't have changes.
      value: left?.value
    } : undefined;

    if (newLeft && newRight) {
      return {
        ...item,
        changeType: 'unchanged',
        left: newLeft,
        right: newRight
      };
    } else if (newLeft) {
      return {
        ...item,
        changeType: 'removed',
        left: newLeft,
      };
    } else if (newRight) {
      return {
        ...item,
        changeType: 'added',
        right: newRight
      };
    } else {
      throw new Error('left or right required or both');
    }
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
        existingItem.changeType = 'removed';
        delete existingItem.right;
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
          right: {
            //  TODO: make sure there's a unit test for both of these paths
            path: [...(right ?? left).path, index],
            value: change[0]
          },
          delta: null,
        });
      }
    }
  }

  return items;
}
