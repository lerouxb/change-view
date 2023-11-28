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
  changeType: ChangeType;
  // TODO: use left and right Branch rather than leftPath, leftValue, rightPath,
  // rightValue. ie. rather use the type system than fight it..
  leftPath?: ObjectPath;
  leftValue?: any | any[];
  rightPath?: ObjectPath;
  rightValue?: any | any[];
  delta: Delta | null;
};

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
  | { left: never, right: Branch } // added
  | { left: Branch, right: never } // removed
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

export function itemsWithChanges({
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
