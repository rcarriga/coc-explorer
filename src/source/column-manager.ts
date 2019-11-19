import { Column, ColumnRegistrar } from './column-registrar';
import { BaseTreeNode, ExplorerSource } from './source';
import { SourceRowBuilder } from './view-builder';
import {prettyPrint} from '../util';

export class ColumnManager<TreeNode extends BaseTreeNode<TreeNode>> {
  columnNames: string[] = [];
  columns: Column<TreeNode>[] = [];

  constructor(public source: ExplorerSource<TreeNode>) {}

  async registerColumns(
    columnNames: string[],
    columnRegistrar: ColumnRegistrar<TreeNode, any, any>,
  ) {
    if (this.columnNames.toString() !== columnNames.toString()) {
      this.columnNames = columnNames;
      this.columns = await columnRegistrar.getColumns(this.source, columnNames);
    }
  }

  /**
   * @returns return true to redraw all rows
   */
  async beforeDraw(nodes: TreeNode[]) {
    let redraw = false;
    for (const column of this.columns) {
      if (column.beforeDraw) {
        if (await column.beforeDraw(nodes)) {
          redraw = true;
        }
      }
    }
    return redraw;
  }

  async reload(sourceNode: TreeNode) {
    for (const column of this.columns) {
      await (column.reload && column.reload(sourceNode));
    }
  }

  draw(node: TreeNode, row: SourceRowBuilder) {
    this.columns.forEach((column) => {
      if (column.concealable) {
        row.concealableColumn(column.concealable, () => {
          column.draw(row, node);
        });
      } else {
        column.draw(row, node);
      }
    });
  }
}