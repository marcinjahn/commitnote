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

note_fonts_dir = meson.project_source_root() / '..' / 'ios' / 'Commitnote' / 'Fonts'
install_data(
  note_fonts_dir / 'AtkinsonHyperlegibleNext-Variable.ttf',
  note_fonts_dir / 'AtkinsonHyperlegibleNext-VariableItalic.ttf',
  note_fonts_dir / 'IBMPlexMono-Italic.ttf',
  note_fonts_dir / 'IBMPlexMono-Regular.ttf',
  note_fonts_dir / 'IBMPlexMono-SemiBold.ttf',
  note_fonts_dir / 'IBMPlexMono-SemiBoldItalic.ttf',
  note_fonts_dir / 'IBMPlexSans-Variable.ttf',
  note_fonts_dir / 'IBMPlexSans-VariableItalic.ttf',
  note_fonts_dir / 'Inter-Variable.ttf',
  note_fonts_dir / 'Inter-VariableItalic.ttf',
  note_fonts_dir / 'JetBrainsMono-Variable.ttf',
  note_fonts_dir / 'JetBrainsMono-VariableItalic.ttf',
  note_fonts_dir / 'Literata-Variable.ttf',
  note_fonts_dir / 'Literata-VariableItalic.ttf',
  note_fonts_dir / 'Lora-Variable.ttf',
  note_fonts_dir / 'Lora-VariableItalic.ttf',
  note_fonts_dir / 'Nunito-Variable.ttf',
  note_fonts_dir / 'Nunito-VariableItalic.ttf',
  note_fonts_dir / 'SourceSerif4-Variable.ttf',
  note_fonts_dir / 'SourceSerif4-VariableItalic.ttf',
  note_fonts_dir / 'iAWriterQuattroS-Bold.ttf',
  note_fonts_dir / 'iAWriterQuattroS-BoldItalic.ttf',
  note_fonts_dir / 'iAWriterQuattroS-Italic.ttf',
  note_fonts_dir / 'iAWriterQuattroS-Regular.ttf',
  install_dir: datadir / app_id / 'fonts',
  install_tag: 'fonts',
)

subdir('ui')

core_bundle_copy = fs.copyfile(core_bundle, 'commitnote-core.js')

resources = gnome.compile_resources(
  'resources',
  'resources.gresource.xml',
  gresource_bundle: true,
  source_dir: [
    meson.current_source_dir(),
    meson.current_build_dir(),
    note_fonts_dir / 'Licenses',
  ],
  dependencies: [ui_files, core_bundle_copy],
)
