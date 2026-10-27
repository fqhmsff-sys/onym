import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_web_plugins/url_strategy.dart';
import 'package:cryptography_flutter/cryptography_flutter.dart';
import 'core/brand.dart';
import 'core/config.dart';
import 'core/i18n.dart';
import 'core/settings.dart';
import 'core/theme.dart';
import 'data/cache.dart';
import 'data/repo.dart';
import 'router.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  usePathUrlStrategy();
  await LocalCache.init();
  FlutterCryptography.enable(); // PBKDF2 memakai kripto bawaan HP/browser (cepat)
  await Repo.i.init();
  appSettings.load();
  runApp(const OnymApp());
}

class OnymApp extends StatefulWidget {
  const OnymApp({super.key});
  @override
  State<OnymApp> createState() => _OnymAppState();
}

class _OnymAppState extends State<OnymApp> {
  late final _router = buildRouter();
  bool _booted = false;
  @override
  void initState() { super.initState(); Repo.i.config().then(appSettings.setRemote); }
  @override
  Widget build(BuildContext context) => ListenableBuilder(listenable: appSettings, builder: (_, __) => MaterialApp.router(
    title: 'Onym', debugShowCheckedModeBanner: false, routerConfig: _router,
    theme: buildTheme(Brightness.light), darkTheme: buildTheme(Brightness.dark), themeMode: appSettings.theme,
    locale: Locale(appSettings.lang), supportedLocales: const [Locale('id'), Locale('en')],
    localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
    builder: (ctx, child) {
      if (!_booted) return LogoLoading(animate: appSettings.motion, onDone: () => setState(() => _booted = true));
      final r = appSettings.remote;
      if ((r['maintenance'] ?? '').isNotEmpty) return _Notice(tr('maint.title'), r['maintenance']!);
      if ((int.tryParse(r['min_version'] ?? '1') ?? 1) > Cfg.buildNumber) return _Notice(tr('update.title'), tr('update.body'));
      return child ?? const SizedBox.shrink();
    },
  ));
}

class _Notice extends StatelessWidget {
  final String title, body;
  const _Notice(this.title, this.body);
  @override
  Widget build(BuildContext context) => Scaffold(body: Center(child: Padding(padding: const EdgeInsets.all(32), child: Column(mainAxisSize: MainAxisSize.min, children: [
    const OnymMark(height: 64), const SizedBox(height: 24), Text(title, style: Theme.of(context).textTheme.titleLarge), const SizedBox(height: 8), Text(body, textAlign: TextAlign.center)]))));
}
