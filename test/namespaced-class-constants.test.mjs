import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtures, fullEngine, observations, parser, reference, snapshot } from './helpers.mjs';

const examples = fixtures('namespaced-class-constants.txt');

test('Pinned Smarty accepts namespace-qualified class constants', () => {
  assert.ok(examples.length >= 13);
  for (const { name, source } of examples) {
    const expected = reference(source);
    assert.equal(expected.error, null, `${name}: ${expected.error}`);
    const root = parser().parse(source).rootNode;
    assert.equal(root.hasError, false, `${name}: ${root.toString()}`);
    assert.deepEqual(expected.events, observations(root), name);
  }
});

test('Qualified constant class, constant field and full range stay distinct', () => {
  for (const [source, expectedClass, expectedSegments, constant] of [
    [String.raw`{App\Class1::CONSTANT}`, String.raw`App\Class1`, 2, 'CONSTANT'],
    [String.raw`{\App\Class1::CONSTANT}`, String.raw`\App\Class1`, 2, 'CONSTANT'],
    [String.raw`{\Demo::VERSION}`, String.raw`\Demo`, 1, 'VERSION'],
    [String.raw`{Demo\IF\TRUE\SeLf::for}`, String.raw`Demo\IF\TRUE\SeLf`, 4, 'for'],
    [String.raw`{1Demo\2Assets::ready}`, String.raw`1Demo\2Assets`, 2, 'ready'],
    [String.raw`{\1Demo\Assets::VERSION}`, String.raw`\1Demo\Assets`, 2, 'VERSION'],
  ]) {
    const root = parser().parse(source).rootNode;
    assert.equal(root.hasError, false, root.toString());
    const node = root.firstNamedChild.childForFieldName('value');
    assert.equal(node.type, 'class_constant_expression', root.toString());
    assert.deepEqual([node.startIndex, node.endIndex], [1, source.length - 1]);
    const klass = node.childForFieldName('class');
    assert.equal(klass.type, 'qualified_name');
    assert.equal(klass.text, expectedClass);
    assert.equal(klass.namedChildren.length, expectedSegments);
    const name = node.childForFieldName('constant');
    assert.deepEqual([name.type, name.text], ['identifier', constant]);
    assert.deepEqual(node.children.filter(child => !child.isNamed).map(child => child.text), ['::']);
    assert.equal(root.descendantsOfType('static_method_call_expression').length, 0);
  }
});

test('Qualified constants compile without loading classes and resolve as class constants', () => {
  for (const source of [
    String.raw`{App\Class1::CONSTANT}`,
    String.raw`{\App\Class1::CONSTANT}`,
    String.raw`{\Demo::VERSION}`,
    String.raw`{Demo\if\true\self\parent::for}`,
    String.raw`{1Demo\2Assets::VERSION}`,
    String.raw`{if $status == App\State::READY}Y{/if}`,
    String.raw`{App\State::READY + 2 * \App\State::RATE}`,
    String.raw`{$x|default:Demo\Assets::FALLBACK}`,
  ]) {
    const result = fullEngine(source, { mode: 'compile' });
    assert.equal(result.error, null, `${source}: ${JSON.stringify(result)}`);
  }
  const rendered = fullEngine(String.raw`{\DateTimeInterface::ATOM|lower}`, { mode: 'render' });
  assert.equal(rendered.error, null, JSON.stringify(rendered));
  assert.equal(rendered.result, String.raw`y-m-d\th:i:sp`);
  const root = parser().parse(String.raw`{\DateTimeInterface::ATOM|lower}`).rootNode;
  assert.equal(root.hasError, false, root.toString());
  assert.equal(root.firstNamedChild.childForFieldName('value').childForFieldName('value').type, 'class_constant_expression');
});

test('Qualified constant ownership in tag attributes and modifier arguments', () => {
  const tag = parser().parse(String.raw`{widget App\State::READY value=\App\State::READY other=$a|x:Demo\A::B}`).rootNode.firstNamedChild;
  assert.equal(tag.type, 'custom_tag', tag.toString());
  assert.equal(tag.childrenForFieldName('argument').length, 1, tag.toString());
  assert.equal(tag.childrenForFieldName('argument')[0].type, 'class_constant_expression');
  const attributes = tag.namedChildren.filter(child => child.type === 'attribute');
  assert.deepEqual(attributes.map(child => child.childForFieldName('name').text), ['value', 'other']);
  assert.equal(attributes[0].childForFieldName('value').type, 'class_constant_expression');
  assert.equal(attributes[0].childForFieldName('value').childForFieldName('class').text, String.raw`\App\State`);
  const modifier = attributes[1].childForFieldName('value');
  assert.equal(modifier.type, 'modifier_expression');
  assert.equal(modifier.childForFieldName('argument').type, 'class_constant_expression');
  assert.equal(modifier.childForFieldName('argument').text, String.raw`Demo\A::B`);
});

test('Qualified constant boundaries and recovery preserve later output', () => {
  for (const malformed of [
    String.raw`{Demo\\Assets::VERSION}`,
    String.raw`{Demo\ Assets::VERSION}`,
    String.raw`{Demo\Assets\::VERSION}`,
    String.raw`{Demo\Assets ::VERSION}`,
    String.raw`{Demo\Assets:: VERSION}`,
    String.raw`{Demo\Assets::}`,
    String.raw`{Demo\Assets:VERSION}`,
    String.raw`{Demo\Assets:::VERSION}`,
    String.raw`{Demo\Assets::VERSION[0]}`,
  ]) {
    const root = parser().parse(`${malformed}{$after}`).rootNode;
    assert.equal(root.hasError, true, `${malformed}: ${root.toString()}`);
    assert.equal(root.descendantsOfType('static_method_call_expression').length, 0, root.toString());
    assert.ok(root.namedChildren.some(node => node.text === '{$after}'), root.toString());
  }
  for (const rejected of [String.raw`{Demo\Assets ::VERSION}`, String.raw`{Demo\Assets:: VERSION}`, String.raw`{Demo\Assets::VERSION[0]}`]) {
    assert.ok(reference(rejected).error, rejected);
  }
  // Smarty accepts these, but standalone namespaced constants, constant access
  // suffixes and static properties remain separate gaps (see Task 052).
  for (const gap of [
    String.raw`{Demo\Assets\VERSION}`,
    String.raw`{Demo\Assets::VERSION->x}`,
    String.raw`{Demo\Assets::$v}`,
  ]) {
    assert.equal(reference(gap).error, null, gap);
    const root = parser().parse(`${gap}{$after}`).rootNode;
    assert.equal(root.hasError, true, `${gap}: ${root.toString()}`);
    assert.ok(root.namedChildren.some(node => node.text === '{$after}'), root.toString());
  }
});

test('Edits across the qualified constant boundary match fresh trees', () => {
  const p = parser();
  let source = '{$before}{if $s == Thing::READY}Y{/if}{$after}';
  let tree = p.parse(source);
  const expectedValue = [];
  for (const [oldText, newText, hasError, type] of [
    ['Thing::READY', String.raw`Demo\Thing::READY`, false, 'class_constant_expression'],
    [String.raw`Demo\Thing::READY`, String.raw`Demo\Thing::ready()`, false, 'static_method_call_expression'],
    [String.raw`Demo\Thing::ready()`, String.raw`Demo\Thing::ready(`, true, null],
    [String.raw`Demo\Thing::ready(`, String.raw`Demo\Thing::READY`, false, 'class_constant_expression'],
    [String.raw`Demo\Thing::READY`, String.raw`Demo\Thing:READY`, true, null],
    [String.raw`Demo\Thing:READY`, String.raw`\Demo\Thing::READY`, false, 'class_constant_expression'],
    [String.raw`\Demo\Thing::READY`, String.raw`\Demo\\Thing::READY`, true, null],
    [String.raw`\Demo\\Thing::READY`, 'Thing::READY', false, 'class_constant_expression'],
  ]) {
    const start = source.indexOf(oldText);
    assert.notEqual(start, -1, oldText);
    const next = source.slice(0, start) + newText + source.slice(start + oldText.length);
    tree.edit({
      startIndex: start, oldEndIndex: start + oldText.length, newEndIndex: start + newText.length,
      startPosition: { row: 0, column: start },
      oldEndPosition: { row: 0, column: start + oldText.length },
      newEndPosition: { row: 0, column: start + newText.length },
    });
    tree = p.parse(next, tree);
    assert.equal(tree.rootNode.hasError, hasError, `${next}: ${tree.rootNode.toString()}`);
    assert.equal(tree.rootNode.namedChildren[0].text, '{$before}');
    assert.equal(tree.rootNode.namedChildren.at(-1).text, '{$after}');
    assert.deepEqual(snapshot(tree.rootNode), snapshot(p.parse(next).rootNode));
    if (type) {
      const condition = tree.rootNode.descendantsOfType('if_tag')[0].childForFieldName('condition');
      assert.equal(condition.childForFieldName('right').type, type, tree.rootNode.toString());
      assert.equal(condition.childForFieldName('right').text, newText);
      expectedValue.push(type);
    }
    source = next;
  }
  assert.equal(expectedValue.length, 5);
});
