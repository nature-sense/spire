import { ProviderDecision, ToolCallProvider, ProviderInfo } from './types.js';

/**
 * GraphQueryProvider — maps natural-language user prompts to graph-memory
 * MCP tool calls using keyword patterns and basic entity extraction.
 *
 * WHY THIS EXISTS:
 * - Gets the full augmentation pipeline working immediately
 * - No training data or LLM required
 * - Easy to debug with console traces
 * - Provides a baseline to compare against future providers
 *
 * UPGRADE PATH:
 * 1. Add more keyword patterns to improve coverage
 * 2. Replace with LLMToolProvider (uses GPT/Claude to choose tools)
 * 3. Replace with FineTunedToolProvider (Graph-ToolFormer)
 */
export class GraphQueryProvider implements ToolCallProvider {
  /**
   * Tool patterns: maps tool names (as exposed by the graph-memory MCP server)
   * to triggering keywords, priority, and configuration.
   *
   * Lower priority number = higher priority (checked first).
   */
  private patterns: Record<
    string,
    {
      keywords: string[];
      priority: number;
      requiresEntity: boolean;
      description: string;
    }
  >;

  constructor() {
    this.patterns = {
      'graph-memory__query_knowledge_graph': {
        keywords: [
          'what is', 'tell me about', 'information about',
          'describe', 'explain', 'who is', 'when did',
          'show me', 'find', 'search for', 'get details',
          'do you know', 'what do you know about',
        ],
        priority: 1,
        requiresEntity: true,
        description: 'General knowledge graph query',
      },
      'graph-memory__find_shortest_path': {
        keywords: [
          'path between', 'connection between', 'relationship between',
          'how is', 'connected to', 'link between',
          'route from', 'how does', 'relate to each other',
        ],
        priority: 2,
        requiresEntity: true,
        description: 'Find path between two entities',
      },
      'graph-memory__get_node_neighbors': {
        keywords: [
          'connections of', 'related to', 'neighbors of',
          'linked to', 'adjacent to', 'what is connected to',
          'what else is', 'surrounding',
        ],
        priority: 3,
        requiresEntity: true,
        description: 'Get connected nodes',
      },
      'graph-memory__get_node_properties': {
        keywords: [
          'properties of', 'attributes of', 'details about',
          'characteristics of', 'what are the properties',
          'get properties', 'show attributes', 'what fields does',
        ],
        priority: 4,
        requiresEntity: true,
        description: 'Get node attributes',
      },
      'graph-memory__get_all_nodes': {
        keywords: [
          'list all', 'show all', 'all nodes', 'all entities',
          'get all', 'show everything', 'list everything',
          'what do you have', 'what is stored',
        ],
        priority: 5,
        requiresEntity: false,
        description: 'List all nodes with filters',
      },
      'graph-memory__project_status': {
        keywords: [
          'project status', 'status of', 'project health',
          'how is the project', 'project overview', 'what is the status',
        ],
        priority: 6,
        requiresEntity: false,
        description: 'Get comprehensive project status',
      },
      'graph-memory__whats_blocking': {
        keywords: [
          'what is blocking', 'blockers for', 'blocking',
          'what blocks', 'dependencies of', 'depends on',
          'what does', 'waiting for',
        ],
        priority: 7,
        requiresEntity: false,
        description: 'Find blockers and dependencies',
      },
      'graph-memory__summarize': {
        keywords: [
          'summarize', 'summary of', 'overview of',
          'give me a summary', 'brief me', 'recap',
        ],
        priority: 8,
        requiresEntity: false,
        description: 'Get summary of all stored concepts',
      },
      'graph-memory__remember': {
        keywords: [
          'remember', 'store', 'save', 'record',
          'add note', 'note that', 'keep track',
          'memorize', 'document that',
        ],
        priority: 9,
        requiresEntity: false,
        description: 'Store a new concept in the knowledge graph',
      },
    };
  }

  // ───── Main Entry Point ─────

  analyzePrompt(prompt: string): ProviderDecision {
    console.log(`[GraphQueryProvider] Analyzing: "${prompt}"`);
    const entities = this.extractEntities(prompt);
    const toolName = this.findBestMatchingTool(prompt);
    const args = this.buildArguments(prompt, toolName, entities);
    const confidence = this.calculateConfidence(prompt, toolName);

    const decision: ProviderDecision = {
      toolName,
      arguments: args,
      originalPrompt: prompt,
      confidence,
      reasoning: toolName
        ? `Matched "${this.getMatchingKeyword(prompt, toolName)}" → ${toolName}`
        : 'No graph-related keywords detected; skipping augmentation',
      augmented: false,
    };

    console.log(
      `[GraphQueryProvider] → ${decision.toolName || 'no tool'}, Confidence: ${confidence.toFixed(2)}`
    );
    return decision;
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'GraphQueryProvider',
      version: '1.0.0',
      description: 'Rule-based tool selection using keyword matching for graph queries',
      supportedTools: Object.keys(this.patterns),
      confidenceThreshold: 0.5,
    };
  }

  // ───── Tool Matching ─────

  /** Find the tool with the highest priority (lowest number) that matches. */
  private findBestMatchingTool(prompt: string): string {
    const promptLower = prompt.toLowerCase();
    const entries = Object.entries(this.patterns).sort(
      (a, b) => a[1].priority - b[1].priority
    );

    for (const [toolName, config] of entries) {
      for (const keyword of config.keywords) {
        if (promptLower.includes(keyword)) {
          return toolName;
        }
      }
    }

    // Graph-related fallback if no specific keyword matched
    if (
      promptLower.includes('graph') ||
      promptLower.includes('knowledge') ||
      promptLower.includes('concept') ||
      promptLower.includes('entity') ||
      promptLower.includes('node') ||
      promptLower.includes('memory')
    ) {
      return 'graph-memory__query_knowledge_graph';
    }

    return ''; // No graph tool detected
  }

  /** Return the keyword that triggered the match (for debugging/trace). */
  private getMatchingKeyword(prompt: string, toolName: string): string {
    if (!toolName) return 'none';
    const promptLower = prompt.toLowerCase();
    const config = this.patterns[toolName];
    if (!config) return 'unknown';
    for (const keyword of config.keywords) {
      if (promptLower.includes(keyword)) return keyword;
    }
    return 'fallback';
  }

  // ───── Entity Extraction ─────

  /**
   * Extract entities from the prompt using multiple strategies:
   * 1. Quoted text: "Paris"
   * 2. "between X and Y" for path finding
   * 3. Entity after prepositions (about, for, of, on, regarding)
   * 4. Capitalized multi-word phrases (proper nouns)
   * 5. Entity after "get" or "find"
   */
  private extractEntities(prompt: string): Record<string, any> {
    const entities: Record<string, any> = {};

    // Strategy 1: Quoted text
    const quotedMatch = prompt.match(/"([^"]*)"/);
    if (quotedMatch) {
      entities.entity = quotedMatch[1];
      return entities;
    }

    // Strategy 2: Two entities for path finding
    const betweenMatch = prompt.match(/between\s+([^and]+?)\s+and\s+([^.]+)/i);
    if (betweenMatch) {
      entities.source = betweenMatch[1].trim();
      entities.target = betweenMatch[2].trim();
      return entities;
    }

    // Strategy 3: Entity after prepositions
    const prepMatch = prompt.match(/\b(?:about|for|of|on|regarding)\s+([^.!?]+)/i);
    if (prepMatch) {
      entities.entity = prepMatch[1].trim();
      return entities;
    }

    // Strategy 4: Capitalized multi-word phrases
    const capitalMatch = prompt.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
    if (capitalMatch && capitalMatch.length > 0) {
      entities.entity = capitalMatch[0];
      if (capitalMatch.length >= 2) {
        entities.source = capitalMatch[0];
        entities.target = capitalMatch[1];
      }
      return entities;
    }

    // Strategy 5: Entity after "get" or "find"
    const getMatch = prompt.match(/\b(?:get|find)\s+([^.!?]+)/i);
    if (getMatch) {
      entities.entity = getMatch[1].trim();
      return entities;
    }

    // Fallback: use first 50 chars as query
    entities.query = prompt.substring(0, 50);
    return entities;
  }

  /** Extract the first recognizable entity from the prompt. */
  private extractFirstEntity(prompt: string): string {
    const entities = this.extractEntities(prompt);
    return entities.entity || entities.source || '';
  }

  // ───── Argument Building ─────

  /** Build arguments for the selected tool based on extracted entities. */
  private buildArguments(
    prompt: string,
    toolName: string,
    entities: Record<string, any>
  ): Record<string, any> | undefined {
    if (!toolName) return undefined;

    const args: Record<string, any> = {};

    switch (toolName) {
      case 'graph-memory__query_knowledge_graph':
        args.query = entities.entity || entities.query || prompt;
        args.limit = 10;
        break;

      case 'graph-memory__find_shortest_path':
        if (entities.source && entities.target) {
          args.source = entities.source;
          args.target = entities.target;
        } else if (entities.entity) {
          const parts = entities.entity.split(/\s+(?:and|to|between)\s+/);
          if (parts.length === 2) {
            args.source = parts[0].trim();
            args.target = parts[1].trim();
          } else {
            args.source = entities.entity;
            args.target = entities.entity;
          }
        } else {
          const words = prompt.match(/\b[A-Z][a-z]+\b/g) || [];
          args.source = words[0] || 'entity1';
          args.target = words[1] || 'entity2';
        }
        args.max_depth = 5;
        break;

      case 'graph-memory__get_node_neighbors':
        args.node_id = entities.entity || this.extractFirstEntity(prompt);
        args.depth = prompt.includes('deep') || prompt.includes('recursive') ? 3 : 1;
        const relMatch = prompt.match(/via\s+([a-zA-Z_]+)/i);
        if (relMatch) args.relationship_type = relMatch[1].toUpperCase();
        break;

      case 'graph-memory__get_node_properties':
        args.node_id = entities.entity || this.extractFirstEntity(prompt);
        const propMatch = prompt.match(/properties\s+(?:of)?\s+([a-zA-Z_,\s]+)/i);
        if (propMatch) {
          const props = propMatch[1].split(/[,\s]+/).filter((p: string) => p.length > 0);
          if (props.length > 0) args.properties = props;
        }
        break;

      case 'graph-memory__get_all_nodes':
        const typeMatch = prompt.match(/(?:all|list)\s+(?:\w+\s+)?([a-zA-Z_]+)/i);
        if (typeMatch) args.node_type = typeMatch[1];
        args.limit = 50;
        args.offset = 0;
        break;

      case 'graph-memory__project_status':
        const nameMatch = prompt.match(
          /(?:status|overview|health)\s+(?:of|for)?\s+([a-zA-Z_]+)/i
        );
        if (nameMatch) args.name = nameMatch[1];
        break;

      case 'graph-memory__whats_blocking':
        args.concept = entities.entity || this.extractFirstEntity(prompt);
        if (!args.concept) {
          // Fallback: extract text after "blocking" keyword
          const blockingMatch = prompt.match(/blocking\s+(.+)/i);
          if (blockingMatch) {
            args.concept = blockingMatch[1].trim();
          } else {
            args.concept = prompt;
          }
        }
        break;

      case 'graph-memory__summarize':
        if (prompt.includes('project') || prompt.includes('projects')) {
          args.category = 'project';
        } else if (prompt.includes('person') || prompt.includes('people')) {
          args.category = 'person';
        } else if (prompt.includes('technology') || prompt.includes('tech')) {
          args.category = 'technology';
        }
        args.include_relationships = prompt.includes('relationship');
        break;

      case 'graph-memory__remember':
        const storeMatch = prompt.match(/remember\s+(?:that\s+)?(.+)/i);
        if (storeMatch) {
          const content = storeMatch[1].trim();
          const isMatch = content.match(/^([^is]+?)\s+is\s+(.+)/i);
          if (isMatch) {
            args.concept = isMatch[1].trim();
            args.details = isMatch[2].trim();
          } else {
            args.concept = content;
            args.details = content;
          }
        } else {
          args.concept = entities.entity || this.extractFirstEntity(prompt);
          args.details = prompt;
        }
        break;

      default:
        args.query = prompt;
    }

    return args;
  }

  // ───── Confidence Scoring ─────

  /** Calculate confidence score (0-1) for the tool decision. */
  private calculateConfidence(prompt: string, toolName: string): number {
    if (!toolName) return 0;

    const promptLower = prompt.toLowerCase();
    const config = this.patterns[toolName];
    if (!config) return 0.3;

    let matches = 0;
    for (const keyword of config.keywords) {
      if (promptLower.includes(keyword)) matches++;
    }

    const baseConfidence = Math.min(matches / config.keywords.length, 0.9);
    const hasEntity = this.extractFirstEntity(prompt) !== '';
    const entityBoost = hasEntity ? 0.1 : -0.1;

    return Math.min(Math.max(baseConfidence + entityBoost, 0.1), 0.95);
  }
}
