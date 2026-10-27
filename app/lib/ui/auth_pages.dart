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
  DateTime? _birth;

  int _age(DateTime birth) {
    final n = DateTime.now();
    var age = n.year - birth.year;
    if (n.month < birth.month || (n.month == birth.month && n.day < birth.day)) age--;
    return age;
  }
  String _birthText(DateTime d) => '${d.day} ${tr('month.${d.month}')} ${d.year}';

  Future<void> _pickBirth() async {
    FocusScope.of(context).unfocus();
    final now = DateTime.now();
    final latest = DateTime(now.year - 11, now.month, now.day);
    final picked = await showDatePicker(
      context: context,
      initialDate: _birth ?? DateTime(latest.year - 4, 1, 1),
      firstDate: DateTime(1900, 1, 1),
      lastDate: latest,
      initialEntryMode: DatePickerEntryMode.calendarOnly,
      helpText: tr('auth.birth'),
      cancelText: tr('cancel'),
      confirmText: tr('auth.birthUse'),
    );
    if (picked != null && mounted) setState(() { _birth = picked; err = null; });
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
    InkWell(borderRadius: BorderRadius.circular(12), onTap: _pickBirth, child: InputDecorator(
      decoration: InputDecoration(prefixIcon: const Icon(Icons.cake_outlined), suffixIcon: const Icon(Icons.chevron_right_rounded)),
      child: _birth == null
        ? Text(tr('auth.birth'), style: const TextStyle(color: Color(0xFF999999)))
        : Row(children: [
            Expanded(child: Text(_birthText(_birth!), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700))),
            Text(tr('auth.ageValue', {'age':'${_age(_birth!)}'}), style: TextStyle(fontSize: 12.5, color: Theme.of(context).colorScheme.onSurface.withValues(alpha: .55))),
          ]),
    )),
    Padding(padding: const EdgeInsets.fromLTRB(4, 7, 4, 0), child: Text(tr('auth.ageHint'), style: TextStyle(fontSize: 12.5, color: Theme.of(context).colorScheme.onSurface.withValues(alpha: .55)))),
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
