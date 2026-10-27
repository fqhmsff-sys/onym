import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import '../core/brand.dart';
import '../core/i18n.dart';
import '../core/util.dart';
import '../data/repo.dart';

class _AuthScaffold extends StatelessWidget {
  final List<Widget> children;
  const _AuthScaffold(this.children);
  @override
  Widget build(BuildContext context) => Scaffold(body: SafeArea(child: Center(child: SingleChildScrollView(
    keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.all(24),
    child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 400), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Center(child: OnymMark(height: 72)), const SizedBox(height: 16), const Center(child: OnymWord(height: 44)), const SizedBox(height: 32), ...children,
    ]))))));
}

mixin _Busy<T extends StatefulWidget> on State<T> {
  bool busy = false; String? err;
  Future<void> run(Future<void> Function() f) async {
    setState(() { busy = true; err = null; });
    try { await f(); } catch (e) { if (mounted) setState(() => err = errText(e, tr)); }
    if (mounted) setState(() => busy = false);
  }
  Widget msg(BuildContext c) => err == null ? const SizedBox.shrink() : Padding(padding: const EdgeInsets.only(top: 10), child: Text(err!, style: TextStyle(color: Theme.of(c).colorScheme.error)));
  Widget btn(String label, VoidCallback f) => FilledButton(onPressed: busy ? null : f, child: busy
      ? Row(mainAxisAlignment: MainAxisAlignment.center, children: [const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)), const SizedBox(width: 10), Text(tr('auth.deriving'))])
      : Text(label));
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginState();
}
class _LoginState extends State<LoginPage> with _Busy {
  final _u = TextEditingController(), _p = TextEditingController();
  void _go() {
    final u = _u.text.trim().toLowerCase();
    if (!usernameRe.hasMatch(u)) { setState(() => err = tr('auth.badUser')); return; }
    run(() => Repo.i.login(u, _p.text));
  }
  @override
  Widget build(BuildContext context) => _AuthScaffold([
    TextField(controller: _u, autofillHints: const [AutofillHints.username], decoration: InputDecoration(hintText: tr('auth.username'), prefixText: '@')), const SizedBox(height: 10),
    TextField(controller: _p, obscureText: true, autofillHints: const [AutofillHints.password], onSubmitted: (_) => _go(), decoration: InputDecoration(hintText: tr('auth.password'))),
    msg(context), const SizedBox(height: 16), btn(tr('auth.login'), _go),
    TextButton(onPressed: () => context.go('/recover'), child: Text(tr('auth.forgot'))),
    TextButton(onPressed: () => context.go('/register'), child: Text(tr('auth.noacc'))),
  ]);
}

class RegisterPage extends StatefulWidget {
  const RegisterPage({super.key});
  @override
  State<RegisterPage> createState() => _RegisterState();
}
class _RegisterState extends State<RegisterPage> with _Busy {
  final _u = TextEditingController(), _n = TextEditingController(), _p = TextEditingController();
  bool _showPass = false;
  int? _day, _month, _year;

  DateTime? get _birth {
    if (_day == null || _month == null || _year == null) return null;
    try {
      final d = DateTime(_year!, _month!, _day!);
      return d.year == _year && d.month == _month && d.day == _day ? d : null;
    } catch (_) { return null; }
  }
  int _age(DateTime birth) {
    final n = DateTime.now();
    var age = n.year - birth.year;
    if (n.month < birth.month || (n.month == birth.month && n.day < birth.day)) age--;
    return age;
  }
  List<int> get _days {
    if (_month == null || _year == null) return List.generate(31, (i) => i + 1);
    return List.generate(DateTime(_year!, _month! + 1, 0).day, (i) => i + 1);
  }
  void _go() {
    final u = _u.text.trim().toLowerCase();
    if (!usernameRe.hasMatch(u)) { setState(() => err = tr('auth.badUser')); return; }
    if (_p.text.length < 8) { setState(() => err = tr('auth.shortPass')); return; }
    final birth = _birth;
    if (birth == null) { setState(() => err = tr('auth.birthRequired')); return; }
    if (_age(birth) < 11) { setState(() => err = tr('auth.age11')); return; }
    run(() => Repo.i.register(u, _n.text.trim().isEmpty ? u : _n.text.trim(), _p.text, birth));
  }
  @override
  Widget build(BuildContext context) => _AuthScaffold([
    TextField(controller: _u, decoration: InputDecoration(hintText: tr('auth.username'), prefixText: '@')), const SizedBox(height: 10),
    TextField(controller: _n, maxLength: 40, buildCounter: (_, {required currentLength, required isFocused, maxLength}) => null, decoration: InputDecoration(hintText: tr('auth.name'))), const SizedBox(height: 10),
    TextField(controller: _p, obscureText: !_showPass, onSubmitted: (_) => _go(), decoration: InputDecoration(hintText: tr('auth.password'), suffixIcon: IconButton(
      tooltip: _showPass ? tr('auth.hidePassword') : tr('auth.showPassword'),
      onPressed: () => setState(() => _showPass = !_showPass),
      icon: Icon(_showPass ? Icons.visibility_off_outlined : Icons.visibility_outlined),
    ))), const SizedBox(height: 10),
    InputDecorator(decoration: InputDecoration(labelText: tr('auth.birth')), child: Row(children: [
      Expanded(child: DropdownButtonHideUnderline(child: DropdownButton<int>(isExpanded: true, value: _day, hint: Text(tr('auth.day')),
        items: [for (final d in _days) DropdownMenuItem(value: d, child: Text('$d'))], onChanged: (v) => setState(() => _day = v)))),
      const SizedBox(width: 8),
      Expanded(child: DropdownButtonHideUnderline(child: DropdownButton<int>(isExpanded: true, value: _month, hint: Text(tr('auth.month')),
        items: [for (var m = 1; m <= 12; m++) DropdownMenuItem(value: m, child: Text(tr('month.$m')))], onChanged: (v) => setState(() { _month = v; if (_day != null && !_days.contains(_day)) _day = null; })))),
      const SizedBox(width: 8),
      Expanded(child: DropdownButtonHideUnderline(child: DropdownButton<int>(isExpanded: true, value: _year, hint: Text(tr('auth.year')),
        items: [for (var y = DateTime.now().year - 11; y >= 1900; y--) DropdownMenuItem(value: y, child: Text('$y'))], onChanged: (v) => setState(() { _year = v; if (_day != null && !_days.contains(_day)) _day = null; })))),
    ])),
    msg(context), const SizedBox(height: 16), btn(tr('auth.register'), _go),
    TextButton(onPressed: () => context.go('/login'), child: Text(tr('auth.haveacc'))),
  ]);
}

class RecoverPage extends StatefulWidget {
  const RecoverPage({super.key});
  @override
  State<RecoverPage> createState() => _RecoverState();
}
class _RecoverState extends State<RecoverPage> with _Busy {
  final _u = TextEditingController(), _c = TextEditingController(), _p = TextEditingController();
  void _go() {
    final u = _u.text.trim().toLowerCase();
    if (!usernameRe.hasMatch(u)) { setState(() => err = tr('auth.badUser')); return; }
    if (_p.text.length < 8) { setState(() => err = tr('auth.shortPass')); return; }
    run(() => Repo.i.recover(u, _c.text.trim(), _p.text));
  }
  @override
  Widget build(BuildContext context) => _AuthScaffold([
    Text(tr('auth.recoverHint'), textAlign: TextAlign.center, style: TextStyle(color: Theme.of(context).colorScheme.onSurface.withValues(alpha: .6))), const SizedBox(height: 16),
    TextField(controller: _u, decoration: InputDecoration(hintText: tr('auth.username'), prefixText: '@')), const SizedBox(height: 10),
    TextField(controller: _c, textCapitalization: TextCapitalization.characters, decoration: InputDecoration(hintText: 'XXXX-XXXX-XXXX')), const SizedBox(height: 10),
    TextField(controller: _p, obscureText: true, onSubmitted: (_) => _go(), decoration: InputDecoration(hintText: tr('auth.newPassword'))),
    msg(context), const SizedBox(height: 16), btn(tr('auth.recover'), _go),
    TextButton(onPressed: () => context.go('/login'), child: Text(tr('auth.login'))),
  ]);
}

/// Kode pemulihan: ditampilkan SEKALI. Tanpa email, inilah satu-satunya cara memulihkan akun bila kata sandi lupa.
class CodesPage extends StatefulWidget {
  const CodesPage({super.key});
  @override
  State<CodesPage> createState() => _CodesState();
}
class _CodesState extends State<CodesPage> {
  bool _saved = false;
  @override
  Widget build(BuildContext context) {
    final codes = Repo.i.pendingCodes ?? const <String>[]; final cs = Theme.of(context).colorScheme;
    return Scaffold(body: SafeArea(child: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(24), child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 420), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(tr('auth.codesTitle'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)), const SizedBox(height: 10),
      Text(tr('auth.codesBody'), textAlign: TextAlign.center, style: TextStyle(color: cs.onSurface.withValues(alpha: .65), height: 1.4)), const SizedBox(height: 18),
      Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: cs.surfaceContainerHighest, borderRadius: BorderRadius.circular(18)),
        child: Wrap(spacing: 18, runSpacing: 10, alignment: WrapAlignment.center, children: [for (final c in codes) SelectableText(c, style: const TextStyle(fontFamily: 'monospace', fontSize: 17, fontWeight: FontWeight.w700, letterSpacing: 1))])),
      const SizedBox(height: 12),
      OutlinedButton.icon(onPressed: () async { await Clipboard.setData(ClipboardData(text: codes.join('\n'))); if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('copied')))); }, icon: const Icon(Icons.copy), label: Text(tr('auth.codesCopy'))),
      CheckboxListTile(contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, value: _saved, onChanged: (v) => setState(() => _saved = v ?? false), title: Text(tr('auth.codesSaved'))),
      FilledButton(onPressed: _saved ? () { Repo.i.codesShown(); context.go('/'); } : null, child: Text(tr('auth.continue'))),
    ]))))));
  }
}
