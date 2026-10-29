blueprints = files(
  'ui/window.blp',
  'ui/startup-error-page.blp',
  'ui/token-page.blp',
  'ui/repository-list-page.blp',
  'ui/unusable-repository-page.blp',
  'ui/unlock-page.blp',
  'ui/initialize-page.blp',
  'ui/loading-page.blp',
  'ui/key-changed-page.blp',
  'ui/notes-page.blp',
  'ui/tree-view.blp',
  'ui/note-view.blp',
)

conf = configuration_data()
conf.set('APP_ID', app_id)
conf.set('SCHEMA_PATH', schema_path)
conf.set('NAME', profile == 'development' ? 'commitnote (Devel)' : 'commitnote')

desktop_file = configure_file(
  input: base_app_id + '.desktop.in',
  output: app_id + '.desktop',
  configuration: conf,
  install: true,
  install_dir: datadir / 'applications',
)
test(
  'desktop-file',
  find_program('desktop-file-validate'),
  args: [desktop_file],
  suite: 'static',
)

metainfo_file = configure_file(
  input: base_app_id + '.metainfo.xml.in',
  output: app_id + '.metainfo.xml',
  configuration: conf,
  install: true,
  install_dir: datadir / 'metainfo',
)
test(
  'metainfo',
  find_program('appstreamcli'),
  args: ['validate', '--no-net', '--explain', metainfo_file],
  suite: 'static',
)

schema_file = configure_file(
  input: base_app_id + '.gschema.xml.in',
  output: app_id + '.gschema.xml',
  configuration: conf,
  install: true,
  install_dir: datadir / 'glib-2.0' / 'schemas',
)
test(
  'gschema',
  find_program('glib-compile-schemas'),
  args: ['--strict', '--dry-run', meson.current_build_dir()],
  suite: 'static',
)
custom_target(
  'gschemas',
  input: schema_file,
  output: 'gschemas.compiled',
  command: [find_program('glib-compile-schemas'), '--targetdir=@OUTDIR@', '@OUTDIR@'],
  build_by_default: true,
)

install_data(
  'icons/hicolor/scalable/apps' / (base_app_id + '.svg'),
  install_dir: datadir / 'icons' / 'hicolor' / 'scalable' / 'apps',
  rename: app_id + '.svg',
)
install_data(
  'icons/hicolor/symbolic/apps' / (base_app_id + '-symbolic.svg'),
  install_dir: datadir / 'icons' / 'hicolor' / 'symbolic' / 'apps',
  rename: app_id + '-symbolic.svg',
)

ui_files = custom_target(
  'blueprints',
  input: blueprints,
  output: '.',
  command: [
    find_program('blueprint-compiler'),
    'batch-compile',
    '@OUTPUT@',
    '@CURRENT_SOURCE_DIR@',
    '@INPUT@',
  ],
)

core_bundle_copy = fs.copyfile(core_bundle, 'commitnote-core.js')

resources = gnome.compile_resources(
  'resources',
  'resources.gresource.xml',
  gresource_bundle: true,
  source_dir: [meson.current_source_dir(), meson.current_build_dir()],
  dependencies: [ui_files, core_bundle_copy],
)
