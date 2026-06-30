import { Tool } from '../core/models/tool';
import { IToolRegistry } from '../core/interfaces/tool-registry';
import { IMemoryGraph } from '../core/interfaces/memory';
import { toSlug } from '../utils/string-utils';

export interface RememberOptions {
  concept: string;
  details: string;
  category?: string;
  related_to?: string;
}

export interface RecallOptions {
  concept: string;
  include_related?: boolean;
}

export interface ListOptions {
  category?: string;
  limit?: number;
}

export interface LinkOptions {
  from: string;
  to: string;
  relation: string;
  evidence?: string;
}

export function registerMemoryTools(
  registry: IToolRegistry,
  memoryGraph: IMemoryGraph,
): void {
  // 1. graph-memory__remember
  registry.register({
    name: 'graph-memory__remember',
    description: 'Store a concept or fact into the knowledge graph.',
    parameters: {
      type: 'object',
      properties: {
        concept: { type: 'string', description: 'The concept name / slug to store' },
        details: { type: 'string', description: 'Long-form description of the concept' },
        category: { type: 'string', description: 'Optional category label for grouping' },
        related_to: { type: 'string', description: 'Optional concept name to link as RELATED_TO' },
      },
      required: ['concept', 'details'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as RememberOptions;
      const id = toSlug(args.concept);

      const node = await memoryGraph.storeNode({
        type: 'entity',
        name: args.concept,
        description: args.details,
        properties: {
          category: args.category || 'concept',
          source: 'user',
          id: id
        }
      });

      let relatedResult = null;
      if (args.related_to) {
        const targetId = toSlug(args.related_to);
        let target = await memoryGraph.getNode(targetId);
        if (!target) {
          target = await memoryGraph.storeNode({
            type: 'entity',
            name: args.related_to,
            description: '',
            properties: { id: targetId, category: 'concept', source: 'user' }
          });
        }
        await memoryGraph.createRelationship({
          type: 'related_to' as any,
          fromId: id,
          toId: targetId,
          properties: { source: 'user' }
        });
        relatedResult = args.related_to;
      }

      return JSON.stringify({ entity: node, related_to: relatedResult }, null, 2);
    },
  });

  // 2. graph-memory__recall
  registry.register({
    name: 'graph-memory__recall',
    description: 'Retrieve a concept from the knowledge graph by name.',
    parameters: {
      type: 'object',
      properties: {
        concept: { type: 'string', description: 'The concept name or slug to retrieve' },
        include_related: { type: 'boolean', description: 'Include outgoing and incoming RELATED_TO nodes' },
      },
      required: ['concept'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as RecallOptions;
      const id = toSlug(args.concept);

      let node = await memoryGraph.getNode(id);
      let matchedBy = 'exact';

      if (!node) {
        const results = await memoryGraph.searchContext(args.concept, { topK: 1 });
        if (results.nodes.length > 0) {
          node = results.nodes[0].node;
          matchedBy = 'semantic';
        }
      }

      if (!node) {
        return JSON.stringify({ message: 'Concept not found' });
      }

      let relatedTo: Array<{ id: string, name: string }> = [];
      let relatedFrom: Array<{ id: string, name: string }> = [];
      
      if (args.include_related) {
        const rels = await memoryGraph.getRelationships(node.id);
        for (const rel of rels) {
          if (rel.fromId === node.id) {
            const target = await memoryGraph.getNode(rel.toId);
            if (target) relatedTo.push({ id: target.id, name: target.name });
          } else {
            const source = await memoryGraph.getNode(rel.fromId);
            if (source) relatedFrom.push({ id: source.id, name: source.name });
          }
        }
      }

      return JSON.stringify({ entity: node, matched_by: matchedBy, related_to: relatedTo, related_from: relatedFrom }, null, 2);
    },
  });

  // 3. graph-memory__forget
  registry.register({
    name: 'graph-memory__forget',
    description: 'Remove a concept and its relationships from the knowledge graph.',
    parameters: {
      type: 'object',
      properties: {
        concept: { type: 'string', description: 'The concept name to forget' },
      },
      required: ['concept'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { concept: string };
      const id = toSlug(args.concept);
      const node = await memoryGraph.getNode(id);
      if (!node) {
        return JSON.stringify({ message: `Concept "${args.concept}" not found` }, null, 2);
      }
      await memoryGraph.deleteNode(id);
      return JSON.stringify({ message: `Forgotten: "${args.concept}"` }, null, 2);
    },
  });

  // 4. graph-memory__list
  registry.register({
    name: 'graph-memory__list',
    description: 'List all concepts in the knowledge graph, optionally filtered by category.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional category to filter by' },
        limit: { type: 'number', description: 'Maximum number of results (default: 20)' },
      },
      required: [],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as ListOptions;
      const limit = args.limit || 20;

      const nodes = await memoryGraph.queryNodes({
        type: 'entity',
        limit: limit + 100
      });

      let filtered = nodes;
      if (args.category) {
        filtered = nodes.filter(n => n.properties?.category === args.category);
      }
      filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      const entities = filtered.slice(0, limit).map(node => ({
        id: node.id,
        name: node.name,
        details: node.description || '',
        type: node.type,
        category: node.properties?.category || 'concept',
        source: node.properties?.source || 'user',
        version: node.version,
        created_at: node.createdAt.toISOString(),
        updated_at: node.updatedAt.toISOString()
      }));

      return JSON.stringify({ count: entities.length, category: args.category, entities }, null, 2);
    },
  });

  // 5. graph-memory__link
  registry.register({
    name: 'graph-memory__link',
    description: 'Create a typed relationship between two concepts.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source concept name' },
        to: { type: 'string', description: 'Target concept name' },
        relation: { type: 'string', description: 'Relationship type' },
        evidence: { type: 'string', description: 'Optional citation or file reference' },
      },
      required: ['from', 'to', 'relation'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as LinkOptions;
      const fromId = toSlug(args.from);
      const toId = toSlug(args.to);

      const fromNode = await memoryGraph.getNode(fromId);
      const toNode = await memoryGraph.getNode(toId);

      if (!fromNode || !toNode) {
        return JSON.stringify({ message: 'Concept not found' }, null, 2);
      }

      const existingRels = await memoryGraph.getRelationships(fromId);
      const exists = existingRels.some(rel => rel.type === args.relation && rel.toId === toId);

      if (!exists) {
        await memoryGraph.createRelationship({
          type: args.relation as any,
          fromId: fromId,
          toId: toId,
          properties: {
            source: 'user',
            evidence: args.evidence || ''
          }
        });
      }
      return JSON.stringify({ message: `Linked "${args.from}" —[${args.relation}]→ "${args.to}"` }, null, 2);
    },
  });

  // 6. graph-memory__project_status
  registry.register({
    name: 'graph-memory__project_status',
    description: 'Get a structured status report for a project concept.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name of the project concept' } },
      required: ['name'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { name: string };
      const id = toSlug(args.name);
      const node = await memoryGraph.getNode(id);
      if (!node) return JSON.stringify({ message: `Project "${args.name}" not found` });

      const rels = await memoryGraph.getRelationships(id);

      const deps = rels.filter(r => r.type === 'depends_on' && r.fromId === id).map(r => r.toId);
      const depNodes = await Promise.all(deps.map(depId => memoryGraph.getNode(depId)));
      const dependencies = depNodes.filter(Boolean).map(n => n!.name);

      const blockers = rels.filter(r => (r.type as string) === 'blocks' && r.fromId === id).map(r => r.toId);
      const blockerNodes = await Promise.all(blockers.map(bId => memoryGraph.getNode(bId)));
      const blockerNames = blockerNodes.filter(Boolean).map(n => n!.name);

      const reportLines = [
        `📊 **${node.name}**`,
        node.description ? `📝 ${node.description}` : '',
        node.properties?.status ? `📈 Status: ${node.properties.status}` : '',
        node.properties?.goal ? `🎯 Goal: ${node.properties.goal}` : '',
        dependencies.length > 0 ? '📦 Dependencies:' : '',
        ...dependencies.map(d => `  • ${d}`),
        blockerNames.length > 0 ? '🚧 Blocks:' : '',
        ...blockerNames.map(b => `  • ${b}`)
      ].filter(Boolean);

      return JSON.stringify({ entity: node, dependencies, blockers: blockerNames, report: reportLines.join('\n') }, null, 2);
    },
  });

  // 7. graph-memory__whats_blocking
  registry.register({
    name: 'graph-memory__whats_blocking',
    description: 'Find all transitive dependencies (up to 2 hops) of a project concept.',
    parameters: {
      type: 'object',
      properties: { concept: { type: 'string', description: 'Name of the project concept' } },
      required: ['concept'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { concept: string };
      const id = toSlug(args.concept);
      const node = await memoryGraph.getNode(id);
      if (!node) return JSON.stringify({ message: `Concept "${args.concept}" not found` });

      const rels = await memoryGraph.getRelationships(id);
      const depIds = rels.filter(r => r.type === 'depends_on' && r.fromId === id).map(r => r.toId);

      const depNodes = await Promise.all(depIds.map(depId => memoryGraph.getNode(depId)));
      const direct = depNodes.filter(Boolean).map(n => n!.name);

      const indirect: string[] = [];
      const seen = new Set<string>(direct);

      for (const depName of direct) {
        const depId = toSlug(depName);
        const depRels = await memoryGraph.getRelationships(depId);
        const childIds = depRels.filter(r => r.type === 'depends_on' && r.fromId === depId).map(r => r.toId);
        
        for (const childId of childIds) {
          const childNode = await memoryGraph.getNode(childId);
          if (childNode && !seen.has(childNode.name) && childNode.id !== id) {
            indirect.push(childNode.name);
            seen.add(childNode.name);
          }
        }
      }

      return JSON.stringify({ concept: args.concept, direct, indirect }, null, 2);
    },
  });

  // 8. graph-memory__summarize
  registry.register({
    name: 'graph-memory__summarize',
    description: 'Get an aggregate summary of the knowledge graph.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional category to scope the summary to' },
        include_relationships: { type: 'boolean', description: 'Include counts for each relationship type' },
      },
      required: [],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { category?: string; include_relationships?: boolean };
      
      const allNodes = await memoryGraph.queryNodes({});
      let nodes = allNodes;
      if (args.category) {
        nodes = allNodes.filter(n => n.properties?.category === args.category);
      }

      const categoryBreakdown: Record<string, number> = {};
      for (const node of nodes) {
        const cat = (node.properties?.category as string) || 'uncategorized';
        categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
      }

      const sorted = [...nodes].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      const recent = sorted.slice(0, 5).map(n => ({
        name: n.name,
        updated_at: n.updatedAt.toISOString()
      }));

      const relationshipCounts: Record<string, number> = {};
      if (args.include_relationships) {
        const relTypes = ['DEPENDS_ON', 'LEADS', 'INSPIRED_BY', 'BLOCKS', 'RELATED_TO', 'MENTIONS', 'CREATED_BY', 'SUPERSEDED_BY'];
        for (const relType of relTypes) {
          let count = 0;
          for (const node of nodes) {
            const rels = await memoryGraph.getRelationships(node.id);
            count += rels.filter(r => r.type === relType || r.type === relType.toLowerCase()).length;
          }
          if (count > 0) relationshipCounts[relType] = count;
        }
      }

      return JSON.stringify({ totalConcepts: nodes.length, categoryBreakdown, recent, relationshipCounts }, null, 2);
    },
  });

  // 9. graph-memory__query
  registry.register({
    name: 'graph-memory__query',
    description: 'Query the knowledge graph with natural language.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        limit: { type: 'number', description: 'Maximum results (default: 10)' },
      },
      required: ['query'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { query: string; limit?: number };
      const limit = args.limit || 10;
      const nodes = await memoryGraph.queryNodes({});
      const searchTerm = args.query.toLowerCase();

      const results = nodes
        .filter(n => 
          n.name.toLowerCase().includes(searchTerm) ||
          (n.description && n.description.toLowerCase().includes(searchTerm)) ||
          (n.properties?.category && String(n.properties.category).toLowerCase().includes(searchTerm))
        )
        .slice(0, limit)
        .map(n => ({
          id: n.id,
          name: n.name,
          description: n.description,
          type: n.type,
          category: n.properties?.category,
          status: n.properties?.status
        }));

      return JSON.stringify({ results, count: results.length }, null, 2);
    },
  });

  // 10. graph-memory__semantic_search
  registry.register({
    name: 'graph-memory__semantic_search',
    description: 'Perform semantic (embedding-based) search across the knowledge graph.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        limit: { type: 'number', description: 'Maximum results (default: 10, max: 50)' },
      },
      required: ['query'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { query: string; limit?: number };
      const limit = args.limit || 10;
      
      const results = await memoryGraph.searchContext(args.query, { topK: limit });
      const items = results.nodes.map(r => ({
        id: r.node.id,
        name: r.node.name,
        content: r.node.description || '',
        category: r.node.properties?.category || 'concept',
        score: r.score
      }));

      return JSON.stringify(items, null, 2);
    },
  });

  // 11. graph-memory__find_shortest_path
  registry.register({
    name: 'graph-memory__find_shortest_path',
    description: 'Find the shortest path between two concepts using BFS traversal.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source concept name' },
        target: { type: 'string', description: 'Target concept name' },
        max_depth: { type: 'number', description: 'Maximum search depth (default: 5)' },
      },
      required: ['source', 'target'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { source: string; target: string; max_depth?: number };
      const sourceId = toSlug(args.source);
      const targetId = toSlug(args.target);
      const maxDepth = args.max_depth || 5;

      const visited = new Set<string>([sourceId]);
      const queue: Array<{ id: string; path: string[]; edges: string[] }> = [
        { id: sourceId, path: [sourceId], edges: [] }
      ];

      let foundPath: { path: string[]; edges: string[]; length: number } | null = null;

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) break;
        const { id, path, edges } = current;
        
        if (path.length > maxDepth) continue;
        
        const rels = await memoryGraph.getRelationships(id);
        for (const rel of rels) {
          const nextId = rel.fromId === id ? rel.toId : rel.fromId;
          if (nextId === targetId) {
            const fullPath = [...path, nextId];
            const pathNodes = await Promise.all(fullPath.map(pId => memoryGraph.getNode(pId)));
            foundPath = {
              path: pathNodes.filter(Boolean).map(n => n!.name),
              edges: [...edges, rel.type],
              length: fullPath.length - 1
            };
            break;
          }
          if (!visited.has(nextId)) {
            visited.add(nextId);
            queue.push({
              id: nextId,
              path: [...path, nextId],
              edges: [...edges, rel.type]
            });
          }
        }
        if (foundPath) break;
      }

      return JSON.stringify(foundPath || { message: 'No path found' }, null, 2);
    },
  });

  // 12. graph-memory__get_node_neighbors
  registry.register({
    name: 'graph-memory__get_node_neighbors',
    description: 'Get all neighbors of a node, with depth and relationship type filtering.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Node name or slug' },
        relationship_type: { type: 'string', description: 'Optional relationship type filter' },
        depth: { type: 'number', description: 'Traversal depth (default: 1)' },
      },
      required: ['node_id'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { node_id: string; relationship_type?: string; depth?: number };
      const id = toSlug(args.node_id);
      
      const node = await memoryGraph.getNode(id);
      if (!node) return JSON.stringify({ message: `Node "${args.node_id}" not found` });

      const depth = Math.min(Math.max(args.depth || 1, 1), 3) as 1 | 2 | 3;
      const result = await memoryGraph.traverse(id, { maxDepth: depth, maxNodes: 100 });

      let relationships = result.relationships;
      if (args.relationship_type) {
        relationships = relationships.filter(r => r.type === args.relationship_type || r.type === args.relationship_type?.toLowerCase());
      }

      const neighbors = result.nodes
        .filter(n => n.id !== id)
        .slice(0, 100)
        .map(n => ({
          id: n.id,
          name: n.name,
          relationship_type: relationships.find(r => r.fromId === n.id || r.toId === n.id)?.type || 'unknown',
          direction: 'both',
          hop: 1
        }));

      return JSON.stringify({ node_id: args.node_id, neighbors, count: neighbors.length }, null, 2);
    },
  });

  // 13. graph-memory__get_node_properties
  registry.register({
    name: 'graph-memory__get_node_properties',
    description: 'Get properties/attributes of a specific concept node.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Node name or slug' },
        properties: { type: 'array', items: { type: 'string' }, description: 'Specific properties to return' },
      },
      required: ['node_id'],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { node_id: string; properties?: string[] };
      const id = toSlug(args.node_id);
      
      const node = await memoryGraph.getNode(id);
      if (!node) return JSON.stringify({ message: `Node "${args.node_id}" not found` });

      const allProps: Record<string, unknown> = {
        id: node.id,
        name: node.name,
        type: node.type,
        description: node.description,
        ...node.properties,
        createdAt: node.createdAt.toISOString(),
        updatedAt: node.updatedAt.toISOString(),
        version: node.version
      };

      let output = allProps;
      if (args.properties && args.properties.length > 0) {
        output = {};
        for (const prop of args.properties) {
          if (prop in allProps) {
            output[prop] = allProps[prop];
          }
        }
      }

      return JSON.stringify(output, null, 2);
    },
  });

  // 14. graph-memory__get_all_nodes
  registry.register({
    name: 'graph-memory__get_all_nodes',
    description: 'List all nodes with optional category/type filter and pagination.',
    parameters: {
      type: 'object',
      properties: {
        node_type: { type: 'string', description: 'Filter by type or category' },
        limit: { type: 'number', description: 'Results per page (default: 20)' },
        offset: { type: 'number', description: 'Pagination offset (default: 0)' },
      },
      required: [],
    },
    execute: async (params: unknown): Promise<string> => {
      const args = params as { node_type?: string; limit?: number; offset?: number };
      const limit = args.limit || 20;
      const offset = args.offset || 0;

      const nodes = await memoryGraph.queryNodes({
        type: args.node_type as any,
        limit: limit + offset + 100
      });

      const paginated = nodes.slice(offset, offset + limit);
      const categories: Record<string, number> = {};
      for (const node of paginated) {
        const cat = (node.properties?.category as string) || 'uncategorized';
        categories[cat] = (categories[cat] || 0) + 1;
      }

      return JSON.stringify({ nodes: paginated, count: paginated.length, categories }, null, 2);
    },
  });

  // 15. graph-memory__get_schema
  registry.register({
    name: 'graph-memory__get_schema',
    description: 'Get the knowledge graph schema definition.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async (): Promise<string> => {
      const schema = {
        node_schema: {
          properties: {
            id: { type: 'string', required: true, description: 'URL-safe slug' },
            name: { type: 'string', required: true, description: 'Human-readable name' },
            details: { type: 'string', required: true, description: 'Long-form description' },
            type: { type: 'string', required: true, description: 'Entity type' },
            category: { type: 'string', required: false, description: 'User label' },
            status: { type: 'string', required: false, description: 'Current status' },
            source: { type: 'string', required: true, description: 'Source of this node' },
            version: { type: 'integer', required: true, description: 'Version number' },
            valid_from: { type: 'string', required: true, description: 'ISO timestamp' },
            valid_to: { type: 'string', required: false, description: 'ISO timestamp or null' },
            created_at: { type: 'string', required: true, description: 'ISO timestamp' },
            updated_at: { type: 'string', required: true, description: 'ISO timestamp' }
          }
        },
        relationship_schema: {
          properties: {
            evidence: { type: 'string', required: false, description: 'Citation or file reference' },
            source: { type: 'string', required: false, description: 'Which tool created this' }
          },
          note: 'Relationship properties are stored for forward compatibility'
        },
        relationship_types: ['DEPENDS_ON', 'LEADS', 'INSPIRED_BY', 'BLOCKS', 'RELATED_TO', 'MENTIONS', 'CREATED_BY', 'SUPERSEDED_BY'],
        constraints: { id: 'unique' }
      };
      return JSON.stringify(schema, null, 2);
    },
  });
}
