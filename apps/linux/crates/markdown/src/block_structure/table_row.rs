use crate::scanners::{is_blank_unit, is_whitespace_unit};

const PIPE: u16 = b'|' as u16;
const BACKSLASH: u16 = b'\\' as u16;
const QUOTE: u16 = b'>' as u16;
const COLON: u16 = b':' as u16;
const DASH: u16 = b'-' as u16;

/// lezer's `hasPipe`: an unescaped pipe anywhere in the row, even one inside a code span.
pub(crate) fn has_pipe(row: &[u16]) -> bool {
    let mut escaped = false;
    row.iter().any(|&unit| {
        let pipe = unit == PIPE && !escaped;
        escaped = !escaped && unit == BACKSLASH;
        pipe
    })
}

/// lezer's `delimiterLine` on a whole source line: a delimiter row after any quote markers and
/// whitespace.
pub(super) fn is_delimiter_line(line: &[u16]) -> bool {
    let row = line
        .iter()
        .position(|&unit| unit != QUOTE && !is_whitespace_unit(unit))
        .map_or(&[][..], |start| &line[start..]);
    is_delimiter_row(row)
}

/// `|? (cell |)+ cell?` over the whole row, where a cell is `\s* :? -+ :? \s*`.
pub(crate) fn is_delimiter_row(row: &[u16]) -> bool {
    if !matches!(row.first(), Some(&(DASH | COLON | PIPE))) {
        return false;
    }
    let mut index = usize::from(row[0] == PIPE);
    let mut closed_cells = 0;
    while let Some(cell_end) = delimiter_cell_end(row, index) {
        match row.get(cell_end) {
            None => return closed_cells > 0,
            Some(&PIPE) => {
                closed_cells += 1;
                index = cell_end + 1;
                if index == row.len() {
                    return true;
                }
            }
            Some(_) => return false,
        }
    }
    false
}

fn delimiter_cell_end(row: &[u16], from: usize) -> Option<usize> {
    let skip = |from: usize, accepts: fn(u16) -> bool| {
        from + row[from..]
            .iter()
            .take_while(|&&unit| accepts(unit))
            .count()
    };
    let colon = |at: usize| at + usize::from(row.get(at) == Some(&COLON));
    let dashes = colon(skip(from, is_whitespace_unit));
    let dashes_end = skip(dashes, |unit| unit == DASH);
    (dashes_end > dashes).then(|| skip(colon(dashes_end), is_whitespace_unit))
}

/// lezer's `parseRow` count: every unescaped pipe closes a cell, unless it is a leading pipe, and
/// content after the last pipe adds one. Only spaces and tabs are blank.
pub(crate) fn row_cell_count(row: &[u16]) -> usize {
    let mut count = 0;
    let mut leading = true;
    let mut in_cell = false;
    let mut escaped = false;
    for &unit in row {
        if unit == PIPE && !escaped {
            if !leading || in_cell {
                count += 1;
            }
            leading = false;
            in_cell = false;
        } else if escaped || !is_blank_unit(unit) {
            in_cell = true;
        }
        escaped = !escaped && unit == BACKSLASH;
    }
    count + usize::from(in_cell)
}
