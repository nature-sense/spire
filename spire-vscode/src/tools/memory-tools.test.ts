/**
 * Tests for memory-tools.ts — verifies that registerMemoryTools registers
 * all expected tools and each tool executes through the ToolRegistry correctly.
 *
 * Run with: npx tsx src/tools/memory-tools.test.ts
 */

import { ToolRegistry } from './tool-registry';
import { registerMemoryTools } from './memory-tools';
import { MemoryGraph } from '../memory/MemoryGraph';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';

// ---------------------------------------------------------------------------
// Test Utilities
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
    console.error(`    Expected: ${JSON.stringify(expected)}`);
    console.error(`    Actual:   ${JSON.stringify(actual)}`);
  }
}

function assertHasKey(obj: Record<string, any>, key: string, message: string): void {
  if (key in obj) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
    console.error(`    Missing key: "${key}" in ${JSON.stringify(Object.keys(obj))}`);
  }
}

function assertToolRegistered(tools: string[], name: string): void {
  assert(tools.includes(name), `Tool "${name}" is registered`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomDbPath(): string {
  const dir = join(tmpdir(), `memory-tools-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function removeDbDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

const TIMEOUT = 30_000; // ms

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests(): Promise<void> {
  let graph: MemoryGraph | null = null;
  const dbDir = randomDbPath();
  const graphPath = resolve(dbDir, 'graph');
  mkdirSync(graphPath, { recursive: true });

  try {
    // ──────────────────────────────────────────────
    // 1. Registration
    // ──────────────────────────────────────────────

    console.log('\n=== Registration ===\n');

    {
      const { container, TYPES } = await import('../core/di/types');
      graph = container.get<MemoryGraph>(TYPES.IMemoryGraph);

      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph);

      const tools = registry.list();
      const names = tools.map(t => t.name);

      assert(names.length >= 15, `at least 15 tools registered (got ${names.length})`);

      const expectedTools = [
        'graph-memory__remember',
        'graph-memory__recall',
        'graph-memory__forget',
        'graph-memory__list',
        'graph-memory__link',
        'graph-memory__project_status',
        'graph-memory__whats_blocking',
        'graph-memory__summarize',
        'graph-memory__query',
        'graph-memory__semantic_search',
        'graph-memory__find_shortest_path',
        'graph-memory__get_node_neighbors',
        'graph-memory__get_node_properties',
        'graph-memory__get_all_nodes',
        'graph-memory__get_schema',
      ];

      for (const name of expectedTools) {
        assertToolRegistered(names, name);
      }

      console.log('  All 15 tools registered correctly.');
    }

    // ──────────────────────────────────────────────
    // 2. remember / recall
    // ──────────────────────────────────────────────

    console.log('\n=== remember / recall ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      // Remember a concept
      const rememberResult = await registry.execute('graph-memory__remember', {
        concept: 'TestConcept',
        details: 'This is a test concept for verification',
        category: 'testing',
      });
      assert(rememberResult.success, 'remember succeeds');
      const rememberParsed = JSON.parse(rememberResult.content);
      const rememberEntity = rememberParsed.entity ?? rememberParsed;
      assert(rememberEntity.id, 'remember returns an entity with id');
      assertEquals(rememberEntity.name, 'TestConcept', 'remember returns entity with name');

      // Recall the same concept
      const recallResult = await registry.execute('graph-memory__recall', {
        concept: 'TestConcept',
      });
      assert(recallResult.success, 'recall succeeds');
      const recallParsed = JSON.parse(recallResult.content);
      assert(recallParsed.entity !== undefined, 'recall returns entity object');
      assertEquals(recallParsed.entity.name, 'TestConcept', 'recall returns matching concept');

      // Recall a non-existent concept
      const recallMissing = await registry.execute('graph-memory__recall', {
        concept: 'NonExistentConcept',
      });
      assert(recallMissing.success, 'recall of missing concept succeeds (returns empty)');
      const recallMissingParsed = JSON.parse(recallMissing.content);
      assert(
        recallMissingParsed.entity === undefined || Object.keys(recallMissingParsed).length === 0,
        'recall of missing returns empty object',
      );

      console.log('  remember/recall tests passed.');
    }

    // ──────────────────────────────────────────────
    // 3. list
    // ──────────────────────────────────────────────

    console.log('\n=== list ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      // List all
      const listAll = await registry.execute('graph-memory__list', {});
      assert(listAll.success, 'list succeeds');
      const listAllParsed = JSON.parse(listAll.content);
      assert(Array.isArray(listAllParsed.entities), 'list returns object with entities array');
      assert(listAllParsed.count !== undefined, 'list returns count');

      // List by category
      const listCategory = await registry.execute('graph-memory__list', {
        category: 'testing',
      });
      assert(listCategory.success, 'list by category succeeds');
      const listCategoryParsed = JSON.parse(listCategory.content);
      assert(Array.isArray(listCategoryParsed.entities), 'list by category returns entities array');
      assertEquals(listCategoryParsed.category, 'testing', 'list by category reflects the category filter');

      // List non-existent category
      const listEmpty = await registry.execute('graph-memory__list', {
        category: '__nonexistent__',
      });
      assert(listEmpty.success, 'list non-existent category succeeds');
      const listEmptyParsed = JSON.parse(listEmpty.content);
      assertEquals(listEmptyParsed.count, 0, 'list non-existent category returns count 0');
      assertEquals(listEmptyParsed.entities.length, 0, 'list non-existent category returns empty entities');

      console.log('  list tests passed.');
    }

    // ──────────────────────────────────────────────
    // 4. link
    // ──────────────────────────────────────────────

    console.log('\n=== link ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      // Remember a second concept to link
      await registry.execute('graph-memory__remember', {
        concept: 'LinkedConcept',
        details: 'Second concept for linking test',
        category: 'testing',
      });

      // Link them
      const linkResult = await registry.execute('graph-memory__link', {
        from: 'TestConcept',
        to: 'LinkedConcept',
        relation: 'DEPENDS_ON',
        evidence: 'Test evidence',
      });
      assert(linkResult.success, 'link succeeds');
      const linkParsed = JSON.parse(linkResult.content);
      assertEquals(linkParsed.from, 'TestConcept', 'link returns from field');
      assertEquals(linkParsed.to, 'LinkedConcept', 'link returns to field');
      assertEquals(linkParsed.relation, 'DEPENDS_ON', 'link stores correct relation type');

      // MemoryGraph.link() does not validate relation types at the graph layer,
      // it simply creates the relationship. So even arbitrary relation names succeed.
      const linkInvalid = await registry.execute('graph-memory__link', {
        from: 'TestConcept',
        to: 'LinkedConcept',
        relation: 'INVALID_RELATION',
      });
      assert(linkInvalid.success, 'link with arbitrary relation succeeds (graph does not validate)');
      const linkInvalidParsed = JSON.parse(linkInvalid.content);
      assertEquals(linkInvalidParsed.relation, 'INVALID_RELATION', 'link stores arbitrary relation type');

      console.log('  link tests passed.');
    }

    // ──────────────────────────────────────────────
    // 5. summarize
    // ──────────────────────────────────────────────

    console.log('\n=== summarize ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      const summaryResult = await registry.execute('graph-memory__summarize', {});
      assert(summaryResult.success, 'summarize succeeds');
      const summaryParsed = JSON.parse(summaryResult.content);
      assertHasKey(summaryParsed, 'totalConcepts', 'summarize returns totalConcepts');
      assert(
        typeof summaryParsed.totalConcepts === 'number' && summaryParsed.totalConcepts >= 2,
        `summarize totalConcepts >= 2 (got ${summaryParsed.totalConcepts})`,
      );
      assertHasKey(summaryParsed, 'categoryBreakdown', 'summarize returns categoryBreakdown');
      assertHasKey(summaryParsed, 'relationshipCounts', 'summarize returns relationshipCounts');

      console.log('  summarize tests passed.');
    }

    // ──────────────────────────────────────────────
    // 6. project_status
    // ──────────────────────────────────────────────

    console.log('\n=== project_status ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      // Add a concept with status and goal for a realistic query
      await registry.execute('graph-memory__remember', {
        concept: 'ProjectTest',
        details: 'A test project entity',
        category: 'project',
      });

      const statusResult = await registry.execute('graph-memory__project_status', {
        name: 'ProjectTest',
      });
      if (!statusResult.success) {
        console.log('  DEBUG project_status error:', statusResult.error);
      }
      assert(statusResult.success, 'project_status succeeds');

      if (statusResult.success) {
        const statusParsed = JSON.parse(statusResult.content);
        assert(statusParsed.entity !== undefined, 'project_status returns entity');
        assertEquals(statusParsed.entity.name, 'ProjectTest', 'project_status returns correct project name');
      }

      // Non-existent project — projectStatus throws "Project not found" which the
      // registry catches, returning success: false and an error string.
      const statusMissing = await registry.execute('graph-memory__project_status', {
        name: '__no_such_project__',
      });
      assert(!statusMissing.success, 'project_status for non-existent concept fails');
      assert(statusMissing.error !== undefined, 'project_status for non-existent returns error message');
      assert(statusMissing.error!.includes('not found') || statusMissing.error!.includes('Project'), 'error mentions project not found');

      console.log('  project_status tests passed.');
    }

    // ──────────────────────────────────────────────
    // 7. whats_blocking
    // ──────────────────────────────────────────────

    console.log('\n=== whats_blocking ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      // Create a project entity for whats_blocking (requires project type)
      await registry.execute('graph-memory__remember', {
        concept: 'BlockableProject',
        details: 'A project entity for blocking test',
        category: 'project',
      });

      const blockingResult = await registry.execute('graph-memory__whats_blocking', {
        concept: 'BlockableProject',
      });
      assert(blockingResult.success, 'whats_blocking succeeds');

      console.log('  whats_blocking tests passed.');
    }

    // ──────────────────────────────────────────────
    // 8. query (Cypher)
    // ──────────────────────────────────────────────

    console.log('\n=== query ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      const queryResult = await registry.execute('graph-memory__query', {
        query: "MATCH (n {name: 'TestConcept'}) RETURN n.name AS name",
      });
      assert(queryResult.success, 'query with Cypher succeeds');
      const queryParsed = JSON.parse(queryResult.content);
      assert(queryParsed.results !== undefined || queryParsed.count !== undefined, 'query returns results/count');
      assert(queryParsed.count >= 1, 'query returns at least 1 result');

      // Invalid Cypher (must contain Cypher keywords to be detected as Cypher)
      const queryInvalid = await registry.execute('graph-memory__query', {
        query: 'MATCH invalid WHERE RETURN bad',
      });
      assert(!queryInvalid.success, 'query with invalid Cypher fails');
      assert(queryInvalid.error !== undefined, 'invalid Cypher returns error');

      console.log('  query tests passed.');
    }

    // ──────────────────────────────────────────────
    // 9. find_shortest_path
    // ──────────────────────────────────────────────

    console.log('\n=== find_shortest_path ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      const pathResult = await registry.execute('graph-memory__find_shortest_path', {
        source: 'TestConcept',
        target: 'LinkedConcept',
      });
      assert(pathResult.success, 'find_shortest_path succeeds for linked concepts');

      // Non-existent path (graph validates both nodes exist)
      const pathMissing = await registry.execute('graph-memory__find_shortest_path', {
        source: 'TestConcept',
        target: '__no_such_node__',
      });
      if (pathMissing.success) {
        const pathMissingParsed = JSON.parse(pathMissing.content);
        assert(
          pathMissingParsed.path === null || pathMissingParsed.path?.length === 0,
          'non-existent path returns null or empty',
        );
      } else {
        // Graph layer throws when target doesn't exist — that's acceptable behavior
        const errMsg = pathMissing.error ?? '';
        assert(
          errMsg.includes('not found') || errMsg.includes('Target'),
          'non-existent target returns not-found error',
        );
      }

      console.log('  find_shortest_path tests passed.');
    }

    // ──────────────────────────────────────────────
    // 10. get_node_neighbors
    // ──────────────────────────────────────────────

    console.log('\n=== get_node_neighbors ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      const neighborsResult = await registry.execute('graph-memory__get_node_neighbors', {
        node_id: 'TestConcept',
      });
      assert(neighborsResult.success, 'get_node_neighbors succeeds');
      const neighborsParsed = JSON.parse(neighborsResult.content);
      assert(Array.isArray(neighborsParsed.neighbors), 'get_node_neighbors returns object with neighbors array');
      assertEquals(typeof neighborsParsed.node_id, 'string', 'get_node_neighbors returns node_id');
      assertEquals(typeof neighborsParsed.count, 'number', 'get_node_neighbors returns count');

      // Non-existent node (throws at graph layer)
      const neighborsMissing = await registry.execute('graph-memory__get_node_neighbors', {
        node_id: '__no_such_node__',
      });
      if (neighborsMissing.success) {
        const neighborsMissingParsed = JSON.parse(neighborsMissing.content);
        assert(
          Array.isArray(neighborsMissingParsed.neighbors) && neighborsMissingParsed.count === 0,
          'get_node_neighbors for missing returns empty neighbors',
        );
      } else {
        const errMsg = neighborsMissing.error ?? '';
        assert(
          errMsg.includes('not found'),
          'get_node_neighbors for missing returns not-found error',
        );
      }

      console.log('  get_node_neighbors tests passed.');
    }

    // ──────────────────────────────────────────────
    // 11. get_node_properties
    // ──────────────────────────────────────────────

    console.log('\n=== get_node_properties ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      const propsResult = await registry.execute('graph-memory__get_node_properties', {
        node_id: 'TestConcept',
      });
      assert(propsResult.success, 'get_node_properties succeeds');
      const propsParsed = JSON.parse(propsResult.content);
      // Returns { node_id, properties: { name, details, category, ... }, property_count }
      assertEquals(propsParsed.node_id, 'TestConcept', 'get_node_properties returns correct node_id');
      assert(propsParsed.properties !== undefined, 'get_node_properties returns properties object');
      assertEquals(propsParsed.properties.name, 'TestConcept', 'get_node_properties returns name in properties');
      assertEquals(typeof propsParsed.property_count, 'number', 'get_node_properties returns property_count');

      // Non-existent node (throws at graph layer)
      const propsMissing = await registry.execute('graph-memory__get_node_properties', {
        node_id: '__no_such_node__',
      });
      if (propsMissing.success) {
        const propsMissingParsed = JSON.parse(propsMissing.content);
        assert(propsMissingParsed.node_id === '__no_such_node__', 'get_node_properties for missing returns node_id');
        assertEquals(propsMissingParsed.property_count, 0, 'get_node_properties for missing returns 0 properties');
      } else {
        const errMsg = propsMissing.error ?? '';
        assert(errMsg.includes('not found'), 'get_node_properties for missing returns not-found error');
      }

      console.log('  get_node_properties tests passed.');
    }

    // ──────────────────────────────────────────────
    // 12. get_all_nodes
    // ──────────────────────────────────────────────

    console.log('\n=== get_all_nodes ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      const allNodesResult = await registry.execute('graph-memory__get_all_nodes', {});
      assert(allNodesResult.success, 'get_all_nodes succeeds');
      const allNodesParsed = JSON.parse(allNodesResult.content);
      // Returns { nodes: [...], count, total, ... }
      assert(Array.isArray(allNodesParsed.nodes), 'get_all_nodes returns object with nodes array');
      assert(allNodesParsed.count >= 3, `get_all_nodes returns >= 3 nodes (got ${allNodesParsed.count})`);
      assertEquals(typeof allNodesParsed.total, 'number', 'get_all_nodes returns total');

      // With limit
      const limitedResult = await registry.execute('graph-memory__get_all_nodes', {
        limit: 1,
      });
      assert(limitedResult.success, 'get_all_nodes with limit succeeds');
      const limitedParsed = JSON.parse(limitedResult.content);
      assert(limitedParsed.nodes.length <= 1, `get_all_nodes with limit=1 returns <= 1 nodes (got ${limitedParsed.nodes.length})`);
      assert(limitedParsed.count <= 1, `get_all_nodes with limit=1 count <= 1 (got ${limitedParsed.count})`);
      assertEquals(typeof limitedParsed.total, 'number', 'get_all_nodes with limit still returns total');

      console.log('  get_all_nodes tests passed.');
    }

    // ──────────────────────────────────────────────
    // 13. get_schema
    // ──────────────────────────────────────────────

    console.log('\n=== get_schema ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      const schemaResult = await registry.execute('graph-memory__get_schema', {});
      assert(schemaResult.success, 'get_schema succeeds');
      const schemaParsed = JSON.parse(schemaResult.content);
      assertHasKey(schemaParsed, 'node_schema', 'schema has node_schema');
      assertHasKey(schemaParsed, 'relationship_schema', 'schema has relationship_schema');
      assertHasKey(schemaParsed, 'relationship_types', 'schema has relationship_types');
      assertHasKey(schemaParsed, 'constraints', 'schema has constraints');

      console.log('  get_schema tests passed.');
    }

    // ──────────────────────────────────────────────
    // 14. forget
    // ──────────────────────────────────────────────

    console.log('\n=== forget ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      // Remember a concept that we will forget
      await registry.execute('graph-memory__remember', {
        concept: 'ToBeForgotten',
        details: 'This will be deleted',
        category: 'testing',
      });

      const forgetResult = await registry.execute('graph-memory__forget', {
        concept: 'ToBeForgotten',
      });
      assert(forgetResult.success, 'forget succeeds');
      const forgetParsed = JSON.parse(forgetResult.content);
      assert(
        forgetParsed.message !== undefined &&
          forgetParsed.message.toLowerCase().includes('forgotten'),
        'forget returns message about forgetting',
      );

      // Verify it's gone
      const recallAfterForget = await registry.execute('graph-memory__recall', {
        concept: 'ToBeForgotten',
      });
      const recallAfterParsed = JSON.parse(recallAfterForget.content);
      assert(
        recallAfterParsed.entity === undefined || Object.keys(recallAfterParsed).length === 0,
        'recall returns empty after forget',
      );

      // Forget non-existent (graph layer returns success with "not found — nothing to forget" message)
      const forgetMissing = await registry.execute('graph-memory__forget', {
        concept: '__never_existed__',
      });
      assert(forgetMissing.success, 'forget of non-existent concept succeeds (returns message)');
      const forgetMissingParsed = JSON.parse(forgetMissing.content);
      assert(
        forgetMissingParsed.message !== undefined &&
          (forgetMissingParsed.message.includes('not found') || forgetMissingParsed.message.includes('nothing to forget')),
        'forget of non-existent returns appropriate message',
      );

      console.log('  forget tests passed.');
    }

    // ──────────────────────────────────────────────
    // 15. semantic_search (optional — needs embedding model)
    // ──────────────────────────────────────────────

    console.log('\n=== semantic_search ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      // If semantic search is not enabled, this may fail gracefully
      const semanticResult = await registry.execute('graph-memory__semantic_search', {
        query: 'test concept',
      });
      // Either succeeds with results or fails gracefully (no embedding model)
      if (!semanticResult.success) {
        const gracefulFailure = !!(
          semanticResult.error?.includes('not initialized') ||
          semanticResult.error?.includes('embedding') ||
          semanticResult.error?.includes('Orama')
        );
        assert(
          gracefulFailure,
          `semantic_search fails gracefully (got: ${semanticResult.error})`,
        );
      } else {
        const semanticParsed = JSON.parse(semanticResult.content);
        assert(Array.isArray(semanticParsed), 'semantic_search returns array when available');
      }

      console.log('  semantic_search tests passed.');
    }

    // ──────────────────────────────────────────────
    // 16. Parameter validation — missing required params
    // ──────────────────────────────────────────────

    console.log('\n=== Parameter Validation ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      // remember without required 'concept'
      const noConcept = await registry.execute('graph-memory__remember', {
        details: 'missing concept field',
      });
      assert(!noConcept.success, 'remember without concept fails');
      assert(noConcept.error !== undefined, 'remember without concept returns error');

      // recall without required 'concept'
      const noRecallConcept = await registry.execute('graph-memory__recall', {});
      assert(!noRecallConcept.success, 'recall without concept fails');

      // link without required 'from'/'to'/'relation'
      const incompleteLink = await registry.execute('graph-memory__link', {
        from: 'TestConcept',
        // missing to and relation
      });
      assert(!incompleteLink.success, 'link without required fields fails');

      console.log('  Parameter validation tests passed.');
    }

    // ──────────────────────────────────────────────
    // 17. Non-existent tool
    // ──────────────────────────────────────────────

    console.log('\n=== Non-existent Tool ===\n');

    {
      const registry = new ToolRegistry();
      registerMemoryTools(registry, graph!);

      const badTool = await registry.execute('graph-memory__nonexistent_tool', {});
      assert(!badTool.success, 'non-existent tool fails');
      assert(badTool.error !== undefined, 'non-existent tool returns error');

      console.log('  Non-existent tool test passed.');
    }

  } finally {
    // Cleanup — just remove the temp db directory
    removeDbDir(dbDir);
  }
}

// ──────────────────────────────────────────────
// Runner
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('  memory-tools.ts — Integration Tests');
  console.log('═'.repeat(60));

  const startTime = Date.now();

  try {
    await runTests();
  } catch (err) {
    failed++;
    console.error(`\nFATAL: Test suite threw: ${(err as Error).message}`);
    console.error((err as Error).stack);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '═'.repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed (${elapsed}s)`);
  console.log('═'.repeat(60) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main();
