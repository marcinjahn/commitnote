import MarkdownStyling
import XCTest

final class TableLayoutTests: XCTestCase {
    private let metrics = TableLayoutMetrics()
    private let accuracy = 1e-9

    private func text(_ low: Double, _ high: Double) -> [TableLayoutItem] {
        [.text(minWidth: low, maxWidth: high)]
    }

    private func uniformHeights(_ cells: [[[TableLayoutItem]]], _ height: Double) -> [[[Double]]] {
        cells.map { row in row.map { items in items.map { _ in height } } }
    }

    private func fitsCells() -> [[[TableLayoutItem]]] {
        [
            [text(20, 50), text(30, 80)],
            [text(10, 40), text(25, 60)],
        ]
    }

    private func fitsGeometry() -> TableGeometry {
        let cells = fitsCells()
        let columns = TableLayout.columns(cells: cells, available: 300, metrics: metrics)
        return TableLayout.geometry(
            cells: cells, columns: columns, textHeights: uniformHeights(cells, 17),
            alignments: [], metrics: metrics)
    }

    func testFitsGivesEachColumnItsMaximumAndDoesNotStretch() {
        let columns = TableLayout.columns(cells: fitsCells(), available: 300, metrics: metrics)
        XCTAssertEqual(columns.contentWidths, [50, 80])
        XCTAssertEqual(columns.paddingX, 8)

        let geometry = fitsGeometry()
        XCTAssertEqual(geometry.columnWidths, [66, 96])
        XCTAssertEqual(geometry.rowHeights, [25, 25])
        XCTAssertEqual(geometry.width, 165)
        XCTAssertEqual(geometry.height, 53)
        XCTAssertLessThan(geometry.width, 300)
        XCTAssertEqual(geometry.cellFrames[0][0], LayoutRect(x: 1, y: 1, width: 66, height: 25))
        XCTAssertEqual(geometry.cellFrames[0][1], LayoutRect(x: 68, y: 1, width: 96, height: 25))
        XCTAssertEqual(geometry.cellFrames[1][0], LayoutRect(x: 1, y: 27, width: 66, height: 25))
        XCTAssertEqual(geometry.cellFrames[1][1], LayoutRect(x: 68, y: 27, width: 96, height: 25))
        XCTAssertEqual(geometry.contentFrames[0][0], LayoutRect(x: 9, y: 5, width: 50, height: 17))
        XCTAssertEqual(geometry.contentFrames[1][1], LayoutRect(x: 76, y: 31, width: 80, height: 17))
        XCTAssertEqual(geometry.itemFrames[0][1], [LayoutRect(x: 76, y: 5, width: 80, height: 17)])
    }

    func testExtraSpaceIsSharedInProportionToTheRangeBetweenMinimumAndMaximum() {
        let cells = [[text(20, 100), text(40, 200)]]
        let columns = TableLayout.columns(cells: cells, available: 200, metrics: metrics)
        XCTAssertEqual(columns.contentWidths[0], 55, accuracy: accuracy)
        XCTAssertEqual(columns.contentWidths[1], 110, accuracy: accuracy)
        XCTAssertGreaterThanOrEqual(columns.contentWidths[0], 20)
        XCTAssertGreaterThanOrEqual(columns.contentWidths[1], 40)

        let geometry = TableLayout.geometry(
            cells: cells, columns: columns, textHeights: uniformHeights(cells, 17),
            alignments: [], metrics: metrics)
        XCTAssertEqual(geometry.width, 200, accuracy: accuracy)
    }

    func testTheLargestMinimumAndMaximumInAColumnDecide() {
        let cells = [[text(10, 30)], [text(25, 20)], [text(5, 60)]]
        let columns = TableLayout.columns(cells: cells, available: 1000, metrics: metrics)
        XCTAssertEqual(columns.contentWidths, [60])

        let narrow = TableLayout.columns(cells: cells, available: 2 + 16 + 40, metrics: metrics)
        XCTAssertEqual(narrow.contentWidths[0], 40, accuracy: accuracy)
        XCTAssertGreaterThanOrEqual(narrow.contentWidths[0], 25)
    }

    func testOverflowScalesColumnsBelowTheirMinimaAndFillsTheContainer() {
        let cells = [[text(100, 200), text(100, 300)]]
        let columns = TableLayout.columns(cells: cells, available: 150, metrics: metrics)
        XCTAssertEqual(columns.contentWidths[0], 57.5, accuracy: accuracy)
        XCTAssertEqual(columns.contentWidths[1], 57.5, accuracy: accuracy)
        XCTAssertEqual(columns.paddingX, 8)

        let geometry = TableLayout.geometry(
            cells: cells, columns: columns, textHeights: uniformHeights(cells, 34),
            alignments: [], metrics: metrics)
        XCTAssertEqual(geometry.width, 150, accuracy: accuracy)
    }

    func testOverflowSplitsInProportionToTheMinima() {
        let cells = [[text(100, 200), text(300, 300)]]
        let columns = TableLayout.columns(cells: cells, available: 3 + 32 + 200, metrics: metrics)
        XCTAssertEqual(columns.contentWidths[0], 50, accuracy: accuracy)
        XCTAssertEqual(columns.contentWidths[1], 150, accuracy: accuracy)
    }

    func testTinyContainerCollapsesContentAndReducesPadding() {
        let cells = fitsCells()
        let columns = TableLayout.columns(cells: cells, available: 20, metrics: metrics)
        XCTAssertEqual(columns.contentWidths, [0, 0])
        XCTAssertEqual(columns.paddingX, 4.25, accuracy: accuracy)

        let geometry = TableLayout.geometry(
            cells: cells, columns: columns, textHeights: uniformHeights(cells, 17),
            alignments: [], metrics: metrics)
        XCTAssertEqual(geometry.columnWidths, [8.5, 8.5])
        XCTAssertEqual(geometry.width, 20, accuracy: accuracy)
        XCTAssertLessThanOrEqual(geometry.width, 20 + accuracy)
    }

    func testContainerNarrowerThanTheBordersNeverGetsNegativePadding() {
        let columns = TableLayout.columns(cells: fitsCells(), available: 1, metrics: metrics)
        XCTAssertEqual(columns.contentWidths, [0, 0])
        XCTAssertEqual(columns.paddingX, 0)
    }

    func testLargeTextStillFitsAndRowsGetTaller() {
        let normal = [[text(20, 100), text(40, 200)]]
        let large = [[text(60, 300), text(120, 600)]]
        let available = 200.0

        let normalColumns = TableLayout.columns(cells: normal, available: available, metrics: metrics)
        let normalGeometry = TableLayout.geometry(
            cells: normal, columns: normalColumns, textHeights: uniformHeights(normal, 17),
            alignments: [], metrics: metrics)

        let largeColumns = TableLayout.columns(cells: large, available: available, metrics: metrics)
        let largeGeometry = TableLayout.geometry(
            cells: large, columns: largeColumns, textHeights: uniformHeights(large, 51 * 3),
            alignments: [], metrics: metrics)

        XCTAssertEqual(largeColumns.contentWidths[0], 55, accuracy: accuracy)
        XCTAssertEqual(largeColumns.contentWidths[1], 110, accuracy: accuracy)
        XCTAssertLessThanOrEqual(largeGeometry.width, available + accuracy)
        XCTAssertEqual(largeGeometry.width, 200, accuracy: accuracy)
        XCTAssertEqual(normalGeometry.rowHeights, [25])
        XCTAssertEqual(largeGeometry.rowHeights, [161])
        XCTAssertGreaterThan(largeGeometry.height, normalGeometry.height)
    }

    func testWidthNeverExceedsAvailableAcrossManySizes() {
        let cells = [
            [text(30, 120), text(10, 400), text(50, 50)],
            [text(5, 60), text(90, 90), text(1, 10)],
        ]
        for available in stride(from: 4.0, through: 900, by: 7) {
            let columns = TableLayout.columns(cells: cells, available: available, metrics: metrics)
            let geometry = TableLayout.geometry(
                cells: cells, columns: columns, textHeights: uniformHeights(cells, 17),
                alignments: [], metrics: metrics)
            XCTAssertLessThanOrEqual(geometry.width, available + accuracy, "available \(available)")
        }
    }

    func testImageSizeScalesDownToTheColumnAndCapsTheHeight() {
        let wide = TableLayout.imageSize(width: 400, height: 200, contentWidth: 100, metrics: metrics)
        XCTAssertEqual(wide.width, 100, accuracy: accuracy)
        XCTAssertEqual(wide.height, 50, accuracy: accuracy)

        let tall = TableLayout.imageSize(width: 100, height: 400, contentWidth: 100, metrics: metrics)
        XCTAssertEqual(tall.width, 40, accuracy: accuracy)
        XCTAssertEqual(tall.height, 160, accuracy: accuracy)

        let small = TableLayout.imageSize(width: 30, height: 20, contentWidth: 100, metrics: metrics)
        XCTAssertEqual(small.width, 30, accuracy: accuracy)
        XCTAssertEqual(small.height, 20, accuracy: accuracy)
    }

    func testImageSizeOfAnImageWithoutSizeIsEmpty() {
        let zeroWidth = TableLayout.imageSize(width: 0, height: 10, contentWidth: 100, metrics: metrics)
        XCTAssertEqual(zeroWidth.width, 0)
        XCTAssertEqual(zeroWidth.height, 0)
        let negativeHeight = TableLayout.imageSize(width: 10, height: -1, contentWidth: 100, metrics: metrics)
        XCTAssertEqual(negativeHeight.width, 0)
        XCTAssertEqual(negativeHeight.height, 0)
    }

    func testImageColumnsHaveASmallMinimumAndANaturalMaximum() {
        let cells: [[[TableLayoutItem]]] = [[[.image(width: 400, height: 200)]]]
        XCTAssertEqual(TableLayout.columns(cells: cells, available: 1000, metrics: metrics).contentWidths, [320])

        let narrow = TableLayout.columns(cells: cells, available: 2 + 16 + 82, metrics: metrics)
        XCTAssertEqual(narrow.contentWidths[0], 82, accuracy: accuracy)

        let tiny = TableLayout.columns(cells: cells, available: 2 + 16 + 10, metrics: metrics)
        XCTAssertEqual(tiny.contentWidths[0], 10, accuracy: accuracy)
    }

    func testImagesAreAlignedByTheColumnAlignment() {
        let image: [TableLayoutItem] = [.image(width: 40, height: 40)]
        let cells = [[image, image, image]]
        let columns = TableLayoutColumns(contentWidths: [100, 100, 100], paddingX: 8)
        let geometry = TableLayout.geometry(
            cells: cells, columns: columns, textHeights: [[[0], [0], [0]]],
            alignments: [.left, .center, .right], metrics: metrics)

        XCTAssertEqual(geometry.itemFrames[0][0], [LayoutRect(x: 9, y: 5, width: 40, height: 40)])
        XCTAssertEqual(geometry.itemFrames[0][1], [LayoutRect(x: 126 + 30, y: 5, width: 40, height: 40)])
        XCTAssertEqual(geometry.itemFrames[0][2], [LayoutRect(x: 243 + 60, y: 5, width: 40, height: 40)])
        XCTAssertEqual(geometry.rowHeights, [48])
    }

    func testMissingAlignmentsCountAsUnspecified() {
        let cells: [[[TableLayoutItem]]] = [[[.image(width: 40, height: 40)], [.image(width: 40, height: 40)]]]
        let columns = TableLayoutColumns(contentWidths: [100, 100], paddingX: 8)
        let geometry = TableLayout.geometry(
            cells: cells, columns: columns, textHeights: [[[0], [0]]], alignments: [.right], metrics: metrics)
        XCTAssertEqual(geometry.itemFrames[0][0][0].x, 9 + 60)
        XCTAssertEqual(geometry.itemFrames[0][1][0].x, 126)
    }

    func testImageAndTextItemsStackWithTheItemGap() {
        let cells: [[[TableLayoutItem]]] = [[[.image(width: 400, height: 200), .text(minWidth: 10, maxWidth: 90)]]]
        let columns = TableLayoutColumns(contentWidths: [100], paddingX: 8)
        let geometry = TableLayout.geometry(
            cells: cells, columns: columns, textHeights: [[[999, 34]]], alignments: [.center], metrics: metrics)

        XCTAssertEqual(geometry.itemFrames[0][0][0], LayoutRect(x: 9, y: 5, width: 100, height: 50))
        XCTAssertEqual(geometry.itemFrames[0][0][1], LayoutRect(x: 9, y: 59, width: 100, height: 34))
        XCTAssertEqual(geometry.contentFrames[0][0].height, 88)
        XCTAssertEqual(geometry.rowHeights, [96])
        XCTAssertEqual(geometry.height, 98)
    }

    func testTextItemsTakeTheFullContentWidthRegardlessOfAlignment() {
        let cells = [[text(10, 90)]]
        let columns = TableLayoutColumns(contentWidths: [100], paddingX: 8)
        let geometry = TableLayout.geometry(
            cells: cells, columns: columns, textHeights: [[[17]]], alignments: [.right], metrics: metrics)
        XCTAssertEqual(geometry.itemFrames[0][0], [LayoutRect(x: 9, y: 5, width: 100, height: 17)])
    }

    func testEmptyCellsUseTheEmptyLineHeightAndEmptyColumnsHaveNoContent() {
        let custom = TableLayoutMetrics(emptyLineHeight: 20)
        let cells: [[[TableLayoutItem]]] = [
            [text(10, 30), []],
            [[], []],
        ]
        let columns = TableLayout.columns(cells: cells, available: 300, metrics: custom)
        XCTAssertEqual(columns.contentWidths, [30, 0])

        let geometry = TableLayout.geometry(
            cells: cells, columns: columns, textHeights: [[[30], []], [[], []]], alignments: [], metrics: custom)
        XCTAssertEqual(geometry.rowHeights, [38, 28])
        XCTAssertEqual(geometry.columnWidths, [46, 16])
        XCTAssertEqual(geometry.contentFrames[1][0], LayoutRect(x: 9, y: 44, width: 30, height: 20))
        XCTAssertEqual(geometry.contentFrames[0][1].width, 0)
        XCTAssertEqual(geometry.itemFrames[1][0], [])
        XCTAssertEqual(geometry.itemFrames[0][1], [])
        XCTAssertEqual(geometry.width, 46 + 16 + 3)
        XCTAssertEqual(geometry.height, 38 + 28 + 3)
    }

    func testAnEmptyTableHasOnlyOuterBorders() {
        let columns = TableLayout.columns(cells: [], available: 100, metrics: metrics)
        XCTAssertEqual(columns.contentWidths, [])
        XCTAssertEqual(columns.paddingX, 8)

        let geometry = TableLayout.geometry(
            cells: [], columns: columns, textHeights: [], alignments: [], metrics: metrics)
        XCTAssertEqual(geometry.width, 1)
        XCTAssertEqual(geometry.height, 1)
        XCTAssertNil(geometry.cell(atX: 0, y: 0))
    }

    func testHairlineBordersAreHonoured() {
        let thin = TableLayoutMetrics(border: 0.5)
        let cells = fitsCells()
        let columns = TableLayout.columns(cells: cells, available: 300, metrics: thin)
        let geometry = TableLayout.geometry(
            cells: cells, columns: columns, textHeights: uniformHeights(cells, 17), alignments: [], metrics: thin)
        XCTAssertEqual(geometry.width, 162 + 1.5, accuracy: accuracy)
        XCTAssertEqual(geometry.height, 50 + 1.5, accuracy: accuracy)
        XCTAssertEqual(geometry.cellFrames[1][1].x, 0.5 + 66 + 0.5, accuracy: accuracy)
        XCTAssertEqual(geometry.cellFrames[1][1].y, 0.5 + 25 + 0.5, accuracy: accuracy)
    }

    func testHitTestFindsCellsBordersAndEdges() {
        let geometry = fitsGeometry()
        func hit(_ x: Double, _ y: Double) -> String {
            guard let cell = geometry.cell(atX: x, y: y) else { return "nil" }
            return "\(cell.row),\(cell.column)"
        }

        XCTAssertEqual(hit(10, 10), "0,0")
        XCTAssertEqual(hit(100, 10), "0,1")
        XCTAssertEqual(hit(10, 40), "1,0")
        XCTAssertEqual(hit(100, 40), "1,1")

        XCTAssertEqual(hit(0, 0), "0,0")
        XCTAssertEqual(hit(66.9, 10), "0,0")
        XCTAssertEqual(hit(67, 10), "0,1")
        XCTAssertEqual(hit(10, 25.9), "0,0")
        XCTAssertEqual(hit(10, 26), "1,0")

        XCTAssertEqual(hit(164, 10), "0,1")
        XCTAssertEqual(hit(164.9, 52.9), "1,1")
        XCTAssertEqual(hit(10, 52), "1,0")

        XCTAssertEqual(hit(165, 10), "nil")
        XCTAssertEqual(hit(10, 53), "nil")
        XCTAssertEqual(hit(-0.1, 10), "nil")
        XCTAssertEqual(hit(10, -0.1), "nil")
    }

    func testHeaderRowIsLaidOutLikeAnyOtherRow() {
        let cells = fitsCells()
        let columns = TableLayout.columns(cells: cells, available: 300, metrics: metrics)
        let geometry = TableLayout.geometry(
            cells: cells, columns: columns, textHeights: [[[30], [17]], [[17], [17]]], alignments: [],
            metrics: metrics)

        XCTAssertEqual(geometry.rowHeights, [38, 25])
        XCTAssertEqual(geometry.cellFrames[0][0], LayoutRect(x: 1, y: 1, width: 66, height: 38))
        XCTAssertEqual(geometry.cellFrames[1][0], LayoutRect(x: 1, y: 40, width: 66, height: 25))
        XCTAssertEqual(geometry.itemFrames[0][1], [LayoutRect(x: 76, y: 5, width: 80, height: 17)])
    }

    func testLayoutRectContainsIsHalfOpen() {
        let rect = LayoutRect(x: 10, y: 20, width: 5, height: 6)
        XCTAssertEqual(rect.maxX, 15)
        XCTAssertEqual(rect.maxY, 26)
        XCTAssertTrue(rect.contains(x: 10, y: 20))
        XCTAssertTrue(rect.contains(x: 14.9, y: 25.9))
        XCTAssertFalse(rect.contains(x: 15, y: 22))
        XCTAssertFalse(rect.contains(x: 12, y: 26))
        XCTAssertFalse(rect.contains(x: 9.9, y: 22))
    }

    func testDefaultMetrics() {
        XCTAssertEqual(
            metrics,
            TableLayoutMetrics(
                cellPaddingX: 8, cellPaddingY: 4, border: 1, emptyLineHeight: 17, imageMaxHeight: 160,
                imageMinWidth: 24, itemGap: 4))
    }
}
