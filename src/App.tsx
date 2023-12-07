import React, { useState, useMemo, useLayoutEffect } from 'react';
import { EJSON } from 'bson';
import { useDarkMode, Card, Select, OptionGroup, Option, css, cx, spacing, fontFamilies, palette } from '@mongodb-js/compass-components';
import type {Fixture } from './fixtures';
import { fixtureGroups } from './fixtures';
import { ChangeView } from './change-view';

const DEFAULT_FIXTURE = 'small change';

const appStyles = css({
  width: '100vw',
  minHeight: '100vh',
  boxSizing: 'border-box',
  padding: spacing[4],
});

const appStylesDark = css({
  backgroundColor: palette.gray.dark2,
  color: palette.gray.light2
});

const appStylesLight = css({
  backgroundColor: palette.gray.light2,
  color: palette.gray.dark2
});

const fixtureSelectorStyles = css({
  paddingRight: spacing[4],
  paddingBottom: spacing[3],
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end'
});

const selectStyles = css({
  minWidth: '300px'
});

const cardStyles = css({
  minHeight: 'auto'
});

const columnsStyles = css({
  display: 'grid',
  width: '100%',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  alignItems: 'stretch'
});

const columnStyles = css({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  padding: '0 24px'
});

const headingStyles = css({
  fontSize: '16px',
  marginBottom: '8px'
});

const codeStyles = css({
  fontFamily: fontFamilies.code,
  fontSize: '12px',
  margin: 0,
  width: '100%',
  display: 'block',
  boxSizing: 'border-box',
  marginBottom: 0,
  flex: 1,
  overflow: 'auto',
  minHeight: '400px'
});

function App() {
  const [fixtureName, setFixtureName] = useState(() => {
    const defaultFixture = localStorage.fixtureName || DEFAULT_FIXTURE;

    let fixture: Fixture = fixtureGroups[0].fixtures[0];
    for (const group of fixtureGroups) {
      for (const f of group.fixtures) {
        if (f.name === defaultFixture) {
          fixture = f;
        }
      }
    }
    return fixture.name;
  });

  const fixture: Fixture = useMemo(() => {
    let fixture: Fixture = fixtureGroups[0].fixtures[0];
    for (const group of fixtureGroups) {
      for (const f of group.fixtures) {
        if (f.name === fixtureName) {
          fixture = f;
        }
      }
    }
    return fixture;
  }, [fixtureName]);

  const onChangeFixture = (value: string) => {
    localStorage.fixtureName = value;
    setFixtureName(value);
  };

  useLayoutEffect(() => {
    console.log(fixture);
  }, [fixture]);

  const darkMode = useDarkMode();

  return (
    <div className={cx(appStyles, darkMode ? appStylesDark : appStylesLight)}>
      <div className={fixtureSelectorStyles}>
        {/* @ts-expect-error leafygreen unreasonably expects a labelledby here */}
        <Select onChange={onChangeFixture} allowDeselect={false} defaultValue={fixtureName} aria-label="Fixture" className={selectStyles}>
          {fixtureGroups.map((group) => (
            <OptionGroup label={group.name} key={group.name}>
            {group.fixtures.map((fixture) => (
              <Option key={fixture.name} value={fixture.name}>{fixture.name}</Option>
            ))}
            </OptionGroup>
          ))}
        </Select>
      </div>
      <Card className={cardStyles}>
        <ChangeView key={fixture.name} name={fixture.name} before={fixture.before} after={fixture.after}/>
      </Card>
      <div className={columnsStyles}>
        <div className={columnStyles}>
          <h3 className={headingStyles}>Before</h3>
          <pre className={codeStyles}>{EJSON.stringify(fixture.before, undefined, 2, { relaxed: false })}</pre>
        </div>
        <div className={columnStyles}>
          <h3 className={headingStyles}>After</h3>
          <pre className={codeStyles}>{EJSON.stringify(fixture.after, undefined, 2, { relaxed: false })}</pre>
        </div>
      </div>
    </div>
  );
}

export default App;
