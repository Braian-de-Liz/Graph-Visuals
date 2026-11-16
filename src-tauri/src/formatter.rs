//! Formatação de código com as ferramentas oficiais de cada linguagem.
//!
//! A IDE não embute formatadores: chama o `gofmt`, o `rustfmt`, o Prettier ou
//! o fixer de PHP que já existem na máquina (ou no projeto). O texto vai por
//! stdin e volta por stdout, sem argumentos vindos do usuário e sem shell. O
//! arquivo em disco só é tocado pelo caminho normal de salvar do editor.
//!
//! Este módulo usa apenas `std` e `which`, de propósito: dá para testá-lo
//! sozinho, sem o Tauri.

use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    Go,
    Rust,
    Script,
    Php,
}

/// Linguagem formatável pela extensão do arquivo, ou `None`.
pub fn lang_for(path: &Path) -> Option<Lang> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "go" => Some(Lang::Go),
        "rs" => Some(Lang::Rust),
        "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs" => Some(Lang::Script),
        "php" => Some(Lang::Php),
        _ => None,
    }
}

/// Procura `rel` (ex.: `node_modules/.bin/prettier`) subindo de `from` até `root`.
fn find_local(root: &Path, from: &Path, rels: &[&str]) -> Option<PathBuf> {
    let mut dir = Some(from);
    while let Some(d) = dir {
        for rel in rels {
            let cand = d.join(rel);
            if cand.is_file() {
                return Some(cand);
            }
        }
        if d == root {
            break;
        }
        dir = d.parent();
    }
    None
}

/// Edição do crate mais próximo (`edition = "2024"`); o rustfmt precisa dela
/// para formatar certo, e em stdin ele não lê o Cargo.toml sozinho.
fn rust_edition(root: &Path, from: &Path) -> String {
    let mut dir = Some(from);
    while let Some(d) = dir {
        if let Ok(text) = std::fs::read_to_string(d.join("Cargo.toml")) {
            for line in text.lines() {
                let line = line.trim();
                if let Some(rest) = line.strip_prefix("edition") {
                    let digits: String = rest.chars().skip_while(|c| *c != '"').skip(1).take_while(|c| c.is_ascii_digit()).collect();
                    if digits.len() == 4 {
                        return digits;
                    }
                }
            }
        }
        if d == root {
            break;
        }
        dir = d.parent();
    }
    "2021".into()
}

fn missing(tool: &str, hint: &str) -> String {
    format!("{tool} não encontrado. {hint}")
}

/// Resolve o executável e os argumentos para `lang`. `file` já é canônico.
fn command_for(lang: Lang, root: &Path, file: &Path) -> Result<(PathBuf, Vec<OsString>), String> {
    let dir = file.parent().unwrap_or(root);
    match lang {
        Lang::Go => {
            let exe = which::which("gofmt").map_err(|_| missing("gofmt", "Instale o Go (ele já inclui o gofmt) e abra a IDE de novo."))?;
            Ok((exe, vec![]))
        }
        Lang::Rust => {
            let exe = which::which("rustfmt").map_err(|_| missing("rustfmt", "Rode `rustup component add rustfmt`."))?;
            Ok((exe, vec!["--edition".into(), rust_edition(root, dir).into()]))
        }
        Lang::Script => {
            let local: &[&str] = if cfg!(windows) {
                &["node_modules/.bin/prettier.cmd", "node_modules/.bin/prettier.exe"]
            } else {
                &["node_modules/.bin/prettier"]
            };
            let exe = find_local(root, dir, local)
                .or_else(|| which::which("prettier").ok())
                .ok_or_else(|| missing("Prettier", "Rode `npm i -D prettier` no projeto (ou `npm i -g prettier`)."))?;
            Ok((exe, vec!["--stdin-filepath".into(), file.as_os_str().to_owned()]))
        }
        Lang::Php => unreachable!("PHP usa arquivo temporário, ver `format_php`"),
    }
}

/// Executa `exe` com o texto em stdin e devolve o stdout. Mata o processo se passar do prazo.
fn run_stdin(exe: &Path, args: &[OsString], cwd: &Path, input: &str) -> Result<String, String> {
    let mut cmd = Command::new(exe);
    cmd.args(args).current_dir(cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let name = exe.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut child = cmd.spawn().map_err(|e| format!("falha ao executar {name}: {e}"))?;

    // stdin, stdout e stderr em threads: evita deadlock com arquivos grandes.
    let mut stdin = child.stdin.take().unwrap();
    let data = input.as_bytes().to_vec();
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(&data);
    });
    let mut out = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        buf
    });
    let mut err = child.stderr.take().unwrap();
    let err_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = err.read_to_end(&mut buf);
        buf
    });

    let deadline = Instant::now() + TIMEOUT;
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(s) => break s,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{name} demorou mais de {}s e foi interrompido", TIMEOUT.as_secs()));
            }
            None => std::thread::sleep(Duration::from_millis(15)),
        }
    };
    let _ = writer.join();
    let stdout = reader.join().unwrap_or_default();
    let stderr = err_reader.join().unwrap_or_default();

    if !status.success() {
        return Err(first_lines(&String::from_utf8_lossy(&stderr), &name, status.code()));
    }
    String::from_utf8(stdout).map_err(|_| format!("{name} devolveu texto que não é UTF-8"))
}

/// Primeiras linhas úteis do stderr (os erros de sintaxe cabem em poucas).
fn first_lines(stderr: &str, name: &str, code: Option<i32>) -> String {
    let lines: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty()).take(4).collect();
    if lines.is_empty() {
        format!("{name} falhou (código {})", code.map_or("?".into(), |c| c.to_string()))
    } else {
        lines.join("\n")
    }
}

/// PHP: os fixers (Pint, PHP-CS-Fixer) trabalham em arquivos, não em stdin.
/// Copia o texto para um arquivo vizinho, formata e apaga.
fn format_php(root: &Path, file: &Path, content: &str) -> Result<String, String> {
    let dir = file.parent().unwrap_or(root);
    let local: &[&str] = if cfg!(windows) {
        &["vendor/bin/pint.bat", "vendor/bin/php-cs-fixer.bat", "vendor/bin/pint", "vendor/bin/php-cs-fixer"]
    } else {
        &["vendor/bin/pint", "vendor/bin/php-cs-fixer"]
    };
    let exe = find_local(root, dir, local)
        .or_else(|| which::which("pint").ok())
        .or_else(|| which::which("php-cs-fixer").ok())
        .ok_or_else(|| missing("Pint ou PHP-CS-Fixer", "Rode `composer require --dev laravel/pint` (ou friendsofphp/php-cs-fixer) no projeto."))?;
    let is_pint = exe.file_stem().is_some_and(|s| s.to_string_lossy().starts_with("pint"));

    let tmp = dir.join(format!(".gv-format-{}.php", std::process::id()));
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    let args: Vec<OsString> = if is_pint {
        vec![tmp.as_os_str().to_owned()]
    } else {
        vec!["fix".into(), "--using-cache=no".into(), "--quiet".into(), tmp.as_os_str().to_owned()]
    };
    let res = run_stdin(&exe, &args, root, "").and_then(|_| std::fs::read_to_string(&tmp).map_err(|e| e.to_string()));
    let _ = std::fs::remove_file(&tmp);
    res
}

/// Formata `content` como o arquivo `file` (canônico, dentro de `root`).
pub fn format(root: &Path, file: &Path, content: &str) -> Result<String, String> {
    let lang = lang_for(file).ok_or_else(|| "formatação não disponível para este tipo de arquivo".to_string())?;
    let out = if lang == Lang::Php {
        format_php(root, file, content)?
    } else {
        let (exe, args) = command_for(lang, root, file)?;
        run_stdin(&exe, &args, file.parent().unwrap_or(root), content)?
    };
    // Nunca devolve vazio para um arquivo com conteúdo: preferimos não mexer.
    if out.trim().is_empty() && !content.trim().is_empty() {
        return Err("o formatador devolveu um resultado vazio; o arquivo foi mantido".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gv-fmt-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        dunce_like(d)
    }
    fn dunce_like(p: PathBuf) -> PathBuf {
        std::fs::canonicalize(p).unwrap()
    }

    #[test]
    fn lang_by_extension() {
        assert_eq!(lang_for(Path::new("a/B.GO")), Some(Lang::Go));
        assert_eq!(lang_for(Path::new("x.tsx")), Some(Lang::Script));
        assert_eq!(lang_for(Path::new("x.php")), Some(Lang::Php));
        assert_eq!(lang_for(Path::new("x.py")), None);
        assert_eq!(lang_for(Path::new("Makefile")), None);
    }

    #[test]
    fn edition_from_nearest_cargo() {
        let d = tmpdir("ed");
        std::fs::write(d.join("Cargo.toml"), "[package]\nname=\"x\"\nedition = \"2024\"\n").unwrap();
        std::fs::create_dir_all(d.join("src")).unwrap();
        assert_eq!(rust_edition(&d, &d.join("src")), "2024");
        let e = tmpdir("ed2");
        assert_eq!(rust_edition(&e, &e), "2021");
    }

    #[test]
    fn gofmt_formats_and_reports_errors() {
        if which::which("gofmt").is_err() {
            return;
        }
        let d = tmpdir("go");
        let f = d.join("a.go");
        let out = format(&d, &f, "package main\nfunc main(){x:=1\n_=x}\n").unwrap();
        assert_eq!(out, "package main\n\nfunc main() {\n\tx := 1\n\t_ = x\n}\n");
        let err = format(&d, &f, "package main\nfunc (").unwrap_err();
        assert!(err.contains("standard input") || err.contains("expected"), "{err}");
    }

    #[test]
    fn rustfmt_respects_edition() {
        if which::which("rustfmt").is_err() {
            return;
        }
        let d = tmpdir("rs");
        std::fs::write(d.join("Cargo.toml"), "[package]\nname=\"x\"\nedition = \"2024\"\n").unwrap();
        let f = d.join("a.rs");
        let out = format(&d, &f, "fn main(){let x=1;println!(\"{}\",x)}\n").unwrap();
        assert_eq!(out, "fn main() {\n    let x = 1;\n    println!(\"{}\", x)\n}\n");
        assert!(format(&d, &f, "fn main( {").is_err());
    }

    #[test]
    fn prettier_uses_filepath_for_parser() {
        if which::which("prettier").is_err() {
            return;
        }
        let d = tmpdir("js");
        let ts = format(&d, &d.join("a.ts"), "const x:number=1;function f(a:string){return a}\n").unwrap();
        assert!(ts.contains("const x: number = 1;"), "{ts}");
        let err = format(&d, &d.join("a.ts"), "const = ;").unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn refuses_unsupported_and_empty_results() {
        let d = tmpdir("un");
        assert!(format(&d, &d.join("a.py"), "x").is_err());
    }

    #[test]
    fn php_without_tool_gives_clear_message() {
        if which::which("pint").is_ok() || which::which("php-cs-fixer").is_ok() {
            return;
        }
        let d = tmpdir("php");
        let err = format(&d, &d.join("a.php"), "<?php echo 1;").unwrap_err();
        assert!(err.contains("composer require"), "{err}");
    }
}
