project(
  'commitnote',
  version: '0.2.0',
  meson_version: '>= 1.1.0',
  license: 'LicenseRef-proprietary',
)

fs = import('fs')
gnome = import('gnome')

profile = get_option('profile')
testing = get_option('testing')

if testing and profile != 'development'
  error('the testing build requires the development profile')
endif

base_app_id = 'io.github.marcinjahn.commitnote'
resource_path = '/io/github/marcinjahn/commitnote/'
if profile == 'development'
  app_id = base_app_id + '.Devel'
  schema_path = resource_path + 'Devel/'
else
  app_id = base_app_id
  schema_path = resource_path
endif

core_bundle = get_option('core_bundle')
if core_bundle == ''
  bundle_dir = testing ? 'dist-native-core-fake' : 'dist-native-core'
  core_bundle = meson.project_source_root() / '..' / '..' / bundle_dir / 'commitnote-core.js'
  if not fs.exists(core_bundle)
    error('run `just build-native-core` first')
  endif
elif not fs.is_absolute(core_bundle)
  error('core_bundle must be an absolute path: ' + core_bundle)
elif not fs.is_file(core_bundle)
  error('core_bundle does not exist: ' + core_bundle)
endif

datadir = get_option('datadir')

subdir('data')

cargo_script = find_program('build-aux/cargo.sh')
cargo_vars = {
  'COMMITNOTE_APP_ID': app_id,
  'COMMITNOTE_PROFILE': profile,
  'COMMITNOTE_VERSION': meson.project_version(),
  'COMMITNOTE_TESTING': testing ? 'true' : 'false',
}
cargo_env = environment(cargo_vars)
cargo_args = [meson.project_build_root(), meson.project_source_root()]

commitnote = custom_target(
  'commitnote',
  output: 'commitnote',
  command: [cargo_script, 'build', cargo_args, '@OUTPUT@'],
  env: cargo_env,
  depends: resources,
  build_always_stale: true,
  build_by_default: true,
  console: true,
  install: true,
  install_dir: get_option('bindir'),
)

test(
  'cargo-test',
  cargo_script,
  args: ['test', cargo_args, 'commitnote'],
  env: cargo_env,
  depends: resources,
  suite: 'cargo',
  timeout: 3600,
  is_parallel: false,
)

if testing
  ui_smoke_env = environment(cargo_vars + {'COMMITNOTE_UI_SUITES': 'smoke'})
  test(
    'ui',
    cargo_script,
    args: ['ui', cargo_args, 'commitnote'],
    env: cargo_env,
    depends: resources,
    suite: 'ui',
    timeout: 900,
    is_parallel: false,
  )

  test(
    'ui-smoke',
    cargo_script,
    args: ['ui', cargo_args, 'commitnote'],
    env: ui_smoke_env,
    depends: resources,
    suite: 'ui-smoke',
    timeout: 300,
    is_parallel: false,
  )
endif

test(
  'versions',
  find_program('build-aux/check-versions.py'),
  args: [
    meson.project_version(),
    meson.project_source_root() / 'Cargo.toml',
    meson.project_source_root() / 'data' / 'io.github.marcinjahn.commitnote.metainfo.xml.in',
  ],
  suite: 'static',
)

test(
  'release-notes',
  find_program('build-aux/release-notes.py'),
  args: [
    meson.project_version(),
    meson.project_source_root() / 'data' / 'io.github.marcinjahn.commitnote.metainfo.xml.in',
  ],
  suite: 'static',
)

run_target(
  'cargo-clippy',
  command: [cargo_script, 'clippy', cargo_args, 'commitnote'],
  env: cargo_env,
  depends: resources,
)

gnome.post_install(glib_compile_schemas: true)
