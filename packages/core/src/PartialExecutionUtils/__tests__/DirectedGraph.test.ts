// NOTE: Diagrams in this file have been created with https://asciiflow.com/#/
// If you update the tests, please update the diagrams as well.
// If you add a test, please create a new diagram.
//
// Map
// 0  means the output has no run data
// 1  means the output has run data
// ►► denotes the node that the user wants to execute to
// XX denotes that the node is disabled
// PD denotes that the node has pinned data

import { createNodeData, defaultWorkflowParameter } from './helpers';
import { DirectedGraph } from '../DirectedGraph';

describe('DirectedGraph', () => {
	//     ┌─────┐    ┌─────┐   ┌─────┐
	//  ┌─►│node1├───►│node2├──►│node3├─┐
	//  │  └─────┘    └─────┘   └─────┘ │
	//  │                               │
	//  └───────────────────────────────┘
	test('roundtrip', () => {
		// ARRANGE
		const node1 = createNodeData({ name: 'Node1' });
		const node2 = createNodeData({ name: 'Node2' });
		const node3 = createNodeData({ name: 'Node3' });

		// ACT
		const graph = new DirectedGraph()
			.addNodes(node1, node2, node3)
			.addConnections(
				{ from: node1, to: node2 },
				{ from: node2, to: node3 },
				{ from: node3, to: node1 },
			);

		// ASSERT
		expect(DirectedGraph.fromWorkflow(graph.toWorkflow({ ...defaultWorkflowParameter }))).toEqual(
			graph,
		);
	});

	describe('getChildren', () => {
		// ┌─────┐    ┌─────┐   ┌─────┐
		// │node1├───►│node2├──►│node3│
		// └─────┘    └─────┘   └─────┘
		test('returns all children', () => {
			// ARRANGE
			const node1 = createNodeData({ name: 'Node1' });
			const node2 = createNodeData({ name: 'Node2' });
			const node3 = createNodeData({ name: 'Node3' });
			const graph = new DirectedGraph()
				.addNodes(node1, node2, node3)
				.addConnections({ from: node1, to: node2 }, { from: node2, to: node3 });

			// ACT
			const children = graph.getChildren(node1);

			// ASSERT
			expect(children.size).toBe(2);
			expect(children).toEqual(new Set([node2, node3]));
		});

		//     ┌─────┐    ┌─────┐   ┌─────┐
		//  ┌─►│node1├───►│node2├──►│node3├─┐
		//  │  └─────┘    └─────┘   └─────┘ │
		//  │                               │
		//  └───────────────────────────────┘
		test('terminates when finding a cycle', () => {
			// ARRANGE
			const node1 = createNodeData({ name: 'Node1' });
			const node2 = createNodeData({ name: 'Node2' });
			const node3 = createNodeData({ name: 'Node3' });
			const graph = new DirectedGraph()
				.addNodes(node1, node2, node3)
				.addConnections(
					{ from: node1, to: node2 },
					{ from: node2, to: node3 },
					{ from: node3, to: node1 },
				);

			// ACT
			const children = graph.getChildren(node1);

			// ASSERT
			expect(children.size).toBe(3);
			expect(children).toEqual(new Set([node1, node2, node3]));
		});
	});
});
