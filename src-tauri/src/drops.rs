//! Native drag-and-drop paths, so only files the user really dropped can be read.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Paths the user actually dropped on the window, with when. The page can
/// only read a dropped file that is on this list (and recent), so the read
/// command can't be used to open arbitrary files.
#[derive(Default)]
pub struct Drops(Mutex<Vec<(PathBuf, Instant)>>);

pub const DROP_TTL: Duration = Duration::from_secs(120);

impl Drops {
    pub fn record(&self, paths: &[PathBuf]) {
        if let Ok(mut list) = self.0.lock() {
            let now = Instant::now();
            list.retain(|(_, t)| now.duration_since(*t) < DROP_TTL);
            for p in paths {
                list.push((p.clone(), now));
            }
            let extra = list.len().saturating_sub(64);
            list.drain(..extra);
        }
    }

    pub fn allows(&self, path: &Path) -> bool {
        let wanted = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let Ok(list) = self.0.lock() else { return false };
        let now = Instant::now();
        list.iter().any(|(p, t)| {
            now.duration_since(*t) < DROP_TTL
                && (p == path || fs::canonicalize(p).map_or(false, |c| c == wanted))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_are_scoped() {
        let dir = std::env::temp_dir().join(format!("sw-drops-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.txt");
        fs::write(&a, "unit_title: A\n").unwrap();
        let drops = Drops::default();
        assert!(!drops.allows(&a));
        drops.record(&[a.clone()]);
        assert!(drops.allows(&a));
        assert!(!drops.allows(&dir.join("b.txt")));
        fs::remove_dir_all(&dir).unwrap();
    }
}
