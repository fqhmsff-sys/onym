import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../core/config.dart';
import '../core/i18n.dart';
import '../data/models.dart';
import '../data/repo.dart';
import '../core/settings.dart';
import 'widgets.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});
  @override
  State<SettingsPage> createState() => _SettingsState();
}
class _SettingsState extends State<SettingsPage> {
  String _dv = 'public', _rv = 'public';
  @override
  void initState() { super.initState(); Repo.i.mySettings().then((s) { if (mounted) setState(() { _dv = '${s['default_visibility'] ?? 'public'}'; _rv = '${s['relations_visibility'] ?? 'public'}'; }); }).catchError((_) {}); }
  Widget _h(String t) => Padding(padding: const EdgeInsets.fromLTRB(16, 20, 16, 6), child: Text(t, style: TextStyle(fontWeight: FontWeight.w800, color: Theme.of(context).colorScheme.primary)));
  Widget _vis(String label, String v, void Function(String) on) => ListTile(title: Text(label), trailing: DropdownButton<String>(value: v, underline: const SizedBox.shrink(),
    items: [for (final k in kVisibilities) DropdownMenuItem(value: k, child: Text(tr('vis.$k')))], onChanged: (x) { if (x != null) on(x); }));
  @override
  Widget build(BuildContext context) {
    final s = appSettings;
    return ListenableBuilder(listenable: s, builder: (_, __) => Scaffold(appBar: AppBar(title: Text(tr('set.title'))), body: ListView(children: [
      _h(tr('set.appearance')),
      ListTile(title: Text(tr('set.theme')), trailing: DropdownButton<ThemeMode>(value: s.theme, underline: const SizedBox.shrink(), items: [
        DropdownMenuItem(value: ThemeMode.system, child: Text(tr('set.system'))), DropdownMenuItem(value: ThemeMode.light, child: Text(tr('set.light'))), DropdownMenuItem(value: ThemeMode.dark, child: Text(tr('set.dark')))],
        onChanged: (v) { if (v != null) s.setTheme(v); })),
      ListTile(title: Text(tr('set.lang')), trailing: DropdownButton<String>(value: s.lang, underline: const SizedBox.shrink(), items: const [DropdownMenuItem(value: 'id', child: Text('Indonesia')), DropdownMenuItem(value: 'en', child: Text('English'))],
        onChanged: (v) { if (v != null) s.setLang(v); })),
      SwitchListTile(title: Text(tr('set.motion')), value: s.motion, onChanged: s.setMotion),
      _h(tr('set.privacy')),
      _vis(tr('set.defaultVis'), _dv, (v) { setState(() => _dv = v); Repo.i.updateProfile({'default_visibility': v}); }),
      _vis(tr('set.relVis'), _rv, (v) { setState(() => _rv = v); Repo.i.updateProfile({'relations_visibility': v}); }),
      ListTile(title: Text(tr('set.blocked')), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/blocked')),
      _h(tr('set.account')),
      ListTile(title: Text(tr('set.saved')), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/saved')),
      ListTile(title: Text(tr('set.relations')), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/relations')),
      ListTile(title: Text(tr('auth.changePassword')), trailing: const Icon(Icons.chevron_right), onTap: () => _changePassword(context)),
      ListTile(title: Text(tr('auth.logout')), onTap: () async { await Repo.i.logout(); }),
      ListTile(title: Text(tr('auth.logoutAll')), onTap: () async { if (await confirm(context, tr('auth.logoutAll') + '?')) await Repo.i.logoutAll(); }),
      ListTile(title: Text(tr('set.delete'), style: TextStyle(color: Theme.of(context).colorScheme.error)), onTap: () async {
        if (!await confirm(context, tr('set.deleteAsk'), ok: tr('delete'))) return;
        try { await Repo.i.deleteAccount(); } catch (e) { if (context.mounted) toast(context, errText(e, tr)); }
      }),
      _h(tr('set.about')),
      ListTile(title: const Text('Onym'), subtitle: Text('${tr('set.version')} 4.0.0 (${Cfg.buildNumber})\n${tr('set.misyi')}'), isThreeLine: true),
      const SizedBox(height: 32),
    ])));
  }
}

Future<void> _changePassword(BuildContext context) async {
  final o = TextEditingController(), n = TextEditingController();
  final go = await showDialog<bool>(context: context, builder: (c) => AlertDialog(title: Text(tr('auth.changePassword')), content: Column(mainAxisSize: MainAxisSize.min, children: [
    TextField(controller: o, obscureText: true, decoration: InputDecoration(hintText: tr('auth.oldPassword'))), const SizedBox(height: 10),
    TextField(controller: n, obscureText: true, decoration: InputDecoration(hintText: tr('auth.newPassword')))]),
    actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('cancel'))), TextButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('save')))]));
  if (go != true) return;
  if (n.text.length < 8) { if (context.mounted) toast(context, tr('auth.shortPass')); return; }
  try { await Repo.i.changePassword(o.text, n.text); if (context.mounted) toast(context, tr('ok')); } catch (e) { if (context.mounted) toast(context, errText(e, tr)); }
}
