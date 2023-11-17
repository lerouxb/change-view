import React, { useState, useMemo, useLayoutEffect, ChangeEventHandler } from 'react';
import { EJSON } from 'bson';
import type {Fixture } from './fixtures';
import { fixtures } from './fixtures';
import { ChangeView } from './change-view';
import './App.css';

const DEFAULT_FIXTURE = 'all-types-changed';

function App() {
  const [fixtureName, setFixtureName] = useState(() => {
    const fixture = fixtures.find((f) => f.name === DEFAULT_FIXTURE);
    return fixture ? fixture.name : fixtures[0].name;
  });

  const fixture: Fixture = useMemo(() => {
    return fixtures.find((f) => f.name === fixtureName) ?? fixtures[0];
  }, [fixtureName]);

  const onChangeFixture: ChangeEventHandler<HTMLSelectElement> = (e) => {
    setFixtureName(e.target.value);
  };

  useLayoutEffect(() => {
    console.log(fixture);
  }, [fixture]);

  return (
    <div className="app">
      <div className="fixture-selector">
        <select onChange={onChangeFixture} defaultValue={fixtureName}>
          {fixtures.map((fixture) => <option key={fixture.name} value={fixture.name}>{fixture.name}</option>)}
        </select>
      </div>
      <div className="card">
        <ChangeView key={fixture.name} name={fixture.name} before={fixture.before} after={fixture.after}/>
      </div>
      <div className="columns">
        <div>
          <h3>Before</h3>
          <pre className="multiline">{EJSON.stringify(fixture.before, undefined, 2)}</pre>
        </div>
        <div>
          <h3>After</h3>
          <pre className="multiline">{EJSON.stringify(fixture.after, undefined, 2)}</pre>
        </div>
      </div>
    </div>
  );
}

export default App;
