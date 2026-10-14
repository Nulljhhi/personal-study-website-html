//! Reading and rewriting the `unit_title:` line of a bank.

/// Convert \r\n and lone \r line endings to \n. The page accepts all three,
/// so the Rust side has to treat them the same way.
/// A leading UTF-8 byte-order mark is dropped too, as the page does, so a
/// bank saved by another editor still has a readable unit_title.
pub fn normalize_newlines(text: &str) -> String {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// The value of the first `unit_title:` line, if any.
pub fn unit_title_of(text: &str) -> Option<String> {
    normalize_newlines(text).lines().find_map(|line| {
        let (tag, value) = line.split_once(':')?;
        (tag.trim() == "unit_title").then(|| value.trim().to_string())
    })
}

/// Replace the value of the first `unit_title:` line. Line endings are
/// normalized to \n first, so every other line is kept intact.
pub fn with_unit_title(text: &str, title: &str) -> String {
    let normalized = normalize_newlines(text);
    let mut done = false;
    let mut out = String::with_capacity(normalized.len() + title.len() + 16);
    for line in normalized.split_inclusive('\n') {
        if !done {
            if let Some((tag, _)) = line.split_once(':') {
                if tag.trim() == "unit_title" {
                    done = true;
                    let ending = if line.ends_with('\n') { "\n" } else { "" };
                    out.push_str(&format!("unit_title: {title}{ending}"));
                    continue;
                }
            }
        }
        out.push_str(line);
    }
    if !done {
        // A file without a unit_title line gets one at the top.
        out = format!("unit_title: {title}\n\n{out}");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_helpers_crlf() {
        let text = "\r\nunit_title: Old; 2026\r\n\r\nquestion: a: b\r\nanswer: c\r\n";
        assert_eq!(unit_title_of(text).as_deref(), Some("Old; 2026"));
        let renamed = with_unit_title(text, "New: Topic; Jan 2026");
        assert_eq!(unit_title_of(&renamed).as_deref(), Some("New: Topic; Jan 2026"));
        assert!(renamed.contains("question: a: b\n"));
        assert!(renamed.contains("answer: c\n"));
    }

    #[test]
    fn rename_keeps_questions_with_cr_only_endings() {
        let text = "unit_title: Old\r\rquestion: What is 2 + 2?\ranswer: 4\r";
        assert_eq!(unit_title_of(text).as_deref(), Some("Old"));
        let renamed = with_unit_title(text, "New");
        assert_eq!(renamed, "unit_title: New\n\nquestion: What is 2 + 2?\nanswer: 4\n");
    }

    // B21: a byte-order mark doesn't hide the unit_title line.
    #[test]
    fn bom_is_ignored() {
        let text = "\u{feff}unit_title: Cells\r\n\r\nquestion: Q\r\nanswer: A\r\n";
        assert_eq!(unit_title_of(text).as_deref(), Some("Cells"));
        let renamed = with_unit_title(text, "Cells 2");
        assert!(renamed.starts_with("unit_title: Cells 2\n"));
    }
}
