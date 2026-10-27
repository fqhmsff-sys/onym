import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../core/config.dart';
import '../core/i18n.dart';
import '../core/util.dart';
import '../data/models.dart';
import '../data/repo.dart';
import 'post_tile.dart';
import 'widgets.dart';

class UserRow extends StatelessWidget {
  final UserLite u; final Widget? trailing;
  const UserRow(this.u, {super.key, this.trailing});
  @override
  Widget build(BuildContext context) => ListTile(leading: Avatar(keyPath: u.avatar, name: u.displayName, size: 44), title: Text(u.displayName, style: const TextStyle(fontWeight: FontWeight.w700)),
    subtitle: Text('@${u.username}'), trailing: trailing, onTap: () => context.push('/u/${u.username}'));
}

class MeTab extends StatefulWidget {
  const MeTab({super.key});
  @override
  State<MeTab> createState() => _MeTabState();
}
class _MeTabState extends State<MeTab> {
  String? _name; bool _err = false;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async { try { final p = await Repo.i.myProfile(refresh: true); if (mounted) setState(() { _name = p.username; _err = false; }); } catch (_) { if (mounted) setState(() => _err = true); } }
  @override
  Widget build(BuildContext context) => _name == null ? (_err ? Empty(tr('error'), onRetry: _load) : const Center(child: CircularProgressIndicator(strokeWidth: 2.5))) : ProfilePage(_name!, tab: true);
}

class ProfilePage extends StatefulWidget {
  final String username; final bool tab;
  const ProfilePage(this.username, {super.key, this.tab = false});
  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  Profile? _p; bool _missing = false, _busy = false; final _posts = PagedController<Post>(); int _gen = 0, _tabIdx = 0;
  @override
  void initState() { super.initState(); _load(); }
  @override
  void didUpdateWidget(ProfilePage o) { super.didUpdateWidget(o); if (o.username != widget.username) _load(); }
  Future<void> _load() async {
    try { final p = await Repo.i.profile(widget.username); if (!mounted) return; setState(() { _p = p; _missing = p == null; _gen++; }); } catch (_) { if (mounted) setState(() => _missing = _p == null); }
  }
  Future<void> _do(Future<void> Function() f) async {
    setState(() => _busy = true);
    try { await f(); await _load(); } catch (e) { if (mounted) toast(context, errText(e, tr)); }
    if (mounted) setState(() => _busy = false);
  }
  Future<void> _relation() async {
    final p = _p!;
    if (p.relationId != null) {
      final ok = await confirm(context, '${tr('rel.${p.relationKind}')} · ${p.relationStatus == 'pending' ? tr('rel.pending') : tr('rel.active')}', ok: tr('rel.remove'));
      if (ok) _do(() => Repo.i.removeRelation(p.relationId!));
      return;
    }
    final k = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      Padding(padding: const EdgeInsets.all(8), child: Text(tr('rel.request'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
      for (final k in kRelationKinds) ListTile(title: Text(tr('rel.$k')), onTap: () => Navigator.pop(c, k)),
    ])));
    if (k != null) _do(() => Repo.i.requestRelation(p.username, k));
  }
  Future<void> _changeAvatar() async {
    final x = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 256, imageQuality: 78);
    if (x == null) return;
    await _do(() async { await Repo.i.uploadAvatar(await x.readAsBytes()); });
  }
  Widget _tabBtn(String label, int i) { final cs = Theme.of(context).colorScheme; final on = _tabIdx == i;
    return Expanded(child: InkWell(onTap: () => setState(() => _tabIdx = i), child: Container(height: 44, alignment: Alignment.center, decoration: BoxDecoration(border: Border(bottom: BorderSide(color: on ? cs.onSurface : Colors.transparent, width: 1.6))),
      child: Text(label, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: on ? cs.onSurface : cs.onSurface.withValues(alpha: .4)))))); }

  @override
  Widget build(BuildContext context) {
    final p = _p; final cs = Theme.of(context).colorScheme; final mute = cs.onSurface.withValues(alpha: .5);
    if (_missing) return Scaffold(appBar: AppBar(), body: Empty(tr('p.notFound')));
    if (p == null) return Scaffold(appBar: widget.tab ? null : AppBar(), body: const Center(child: CircularProgressIndicator(strokeWidth: 2.5)));
    final header = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(padding: const EdgeInsets.fromLTRB(18, 8, 18, 0), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(p.displayName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 24, height: 1.15)),
          const SizedBox(height: 3), Row(children: [Flexible(child: Text(p.username, style: const TextStyle(fontSize: 15.5), overflow: TextOverflow.ellipsis)),
            if (p.followsMe && !p.isMe) Container(margin: const EdgeInsets.only(left: 8), padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: cs.surfaceContainerHighest, borderRadius: BorderRadius.circular(8)), child: Text(tr('p.followsYou'), style: TextStyle(fontSize: 11.5, color: mute)))]),
          if ((p.bio ?? '').isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text(p.bio!, style: const TextStyle(fontSize: 15.5, height: 1.35))),
          if (p.birthDate != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text('🎂 ${p.birthDate}', style: TextStyle(color: mute, fontSize: 13.5))),
        ])),
        const SizedBox(width: 14), GestureDetector(onTap: p.isMe ? _changeAvatar : null, child: Avatar(keyPath: p.avatar, name: p.displayName, size: 84)),
      ])),
      Padding(padding: const EdgeInsets.fromLTRB(18, 14, 18, 14), child: Row(children: [
        GestureDetector(onTap: () => context.push('/u/${p.username}/followers'), child: Text('${p.followers} ${tr('p.followers').toLowerCase()}', style: TextStyle(color: mute, fontSize: 15))),
        Text('  ·  ', style: TextStyle(color: mute)), GestureDetector(onTap: () => context.push('/u/${p.username}/following'), child: Text('${p.following} ${tr('p.following').toLowerCase()}', style: TextStyle(color: mute, fontSize: 15))),
      ])),
      Padding(padding: const EdgeInsets.symmetric(horizontal: 18), child: p.isMe
        ? Row(children: [Expanded(child: OutlinedButton(onPressed: () async { await context.push('/profile/edit'); _load(); }, child: Text(tr('p.edit')))), const SizedBox(width: 8),
            Expanded(child: OutlinedButton(onPressed: () => context.push('/relations'), child: Text(tr('rel.title')))), const SizedBox(width: 8),
            OutlinedButton(onPressed: () async { await Clipboard.setData(ClipboardData(text: '${Cfg.webOrigin}/u/${p.username}')); if (mounted) toast(context, tr('copied')); }, style: OutlinedButton.styleFrom(minimumSize: const Size(46, 40), padding: EdgeInsets.zero), child: const Icon(Icons.ios_share, size: 21))])
        : p.blocked ? SizedBox(width: double.infinity, child: OutlinedButton(onPressed: _busy ? null : () => _do(() => Repo.i.block(p.username, false)), child: Text(tr('p.unblock'))))
        : Row(children: [Expanded(child: p.iFollow ? OutlinedButton(onPressed: _busy ? null : () => _do(() => Repo.i.follow(p.username, false)), child: Text(tr('p.unfollow')))
              : FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(0, 40)), onPressed: _busy ? null : () => _do(() => Repo.i.follow(p.username, true)), child: Text(tr('p.follow')))), const SizedBox(width: 8),
            Expanded(child: OutlinedButton(onPressed: _busy ? null : _relation, child: Text(p.relationId == null ? tr('p.relation') : '${tr('rel.${p.relationKind}')}${p.relationStatus == 'pending' ? ' · ${tr('rel.pending')}' : ''}', overflow: TextOverflow.ellipsis)))])),
      const SizedBox(height: 16),
      if (!p.blocked) Container(decoration: BoxDecoration(border: Border(bottom: BorderSide(color: cs.outline, width: .5))), child: Row(children: [_tabBtn(tr('prof.posts'), 0), _tabBtn(tr('prof.media'), 1)])),
    ]);
    return Scaffold(
      appBar: AppBar(title: widget.tab ? null : Text(p.username), automaticallyImplyLeading: !widget.tab, actions: [
        if (widget.tab) IconButton(onPressed: () => context.push('/settings'), icon: const Icon(Icons.settings_outlined, size: 26)),
        if (!p.isMe && !p.blocked) PopupMenuButton<String>(onSelected: (v) async { if (v == 'block' && await confirm(context, tr('p.blockAsk'), ok: tr('p.block'))) _do(() => Repo.i.block(p.username, true)); },
            itemBuilder: (_) => [PopupMenuItem(value: 'block', child: Text(tr('p.block')))]),
      ]),
      body: p.blocked ? ListView(children: [header]) : PagedList<Post>(key: ValueKey('${p.id}-$_gen'), controller: _posts, header: header, load: (c) => Repo.i.userPosts(p.username, cursor: c),
          idOf: (x) => x.id, empty: tr('feed.empty'), filter: _tabIdx == 1 ? (x) => x.media.isNotEmpty : null, item: (c, x) => PostTile(x, onDeleted: (d) => _posts.removeWhere((e) => e.id == d.id))),
    );
  }
}

class FollowListPage extends StatelessWidget {
  final String username, kind;
  const FollowListPage(this.username, this.kind, {super.key});
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(tr(kind == 'followers' ? 'p.followers' : 'p.following'))),
    body: PagedList<UserLite>(load: (c) => Repo.i.followList(username, kind, cursor: c), idOf: (u) => u.id, empty: tr('s.none'), item: (c, u) => UserRow(u)));
}

class EditProfilePage extends StatefulWidget {
  const EditProfilePage({super.key});
  @override
  State<EditProfilePage> createState() => _EditProfileState();
}
class _EditProfileState extends State<EditProfilePage> {
  final _n = TextEditingController(), _b = TextEditingController(); DateTime? _birth; String _bv = 'me'; bool _loading = true, _busy = false;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try { final s = await Repo.i.mySettings(); _n.text = '${s['display_name'] ?? ''}'; _b.text = '${s['bio'] ?? ''}'; _birth = DateTime.tryParse('${s['birth_date'] ?? ''}'); _bv = '${s['birth_date_visibility'] ?? 'me'}'; } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }
  Future<void> _save() async {
    if (_n.text.trim().isEmpty) return;
    setState(() => _busy = true);
    try {
      await Repo.i.updateProfile({'display_name': _n.text.trim(), 'bio': _b.text.trim().isEmpty ? null : _b.text.trim(),
        'birth_date': _birth == null ? null : '${_birth!.year.toString().padLeft(4, '0')}-${_birth!.month.toString().padLeft(2, '0')}-${_birth!.day.toString().padLeft(2, '0')}', 'birth_date_visibility': _bv});
      if (mounted) context.pop();
    } catch (e) { if (mounted) { toast(context, errText(e, tr)); setState(() => _busy = false); } }
  }
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(tr('p.edit')), actions: [Padding(padding: const EdgeInsets.only(right: 12), child: FilledButton(onPressed: _busy ? null : _save, child: Text(tr('save'))))]),
    body: _loading ? const Center(child: CircularProgressIndicator(strokeWidth: 2.5)) : ListView(padding: const EdgeInsets.all(16), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
      TextField(controller: _n, maxLength: 40, decoration: InputDecoration(labelText: tr('auth.name'))), const SizedBox(height: 8),
      TextField(controller: _b, maxLength: 160, minLines: 2, maxLines: 4, decoration: InputDecoration(labelText: tr('p.bio'))), const SizedBox(height: 8),
      ListTile(contentPadding: EdgeInsets.zero, title: Text(tr('p.birth')), subtitle: Text(_birth == null ? '—' : '${_birth!.day}/${_birth!.month}/${_birth!.year}'),
        trailing: Row(mainAxisSize: MainAxisSize.min, children: [if (_birth != null) IconButton(onPressed: () => setState(() => _birth = null), icon: const Icon(Icons.close)), const Icon(Icons.calendar_month_outlined)]),
        onTap: () async { final d = await showDatePicker(context: context, initialDate: _birth ?? DateTime(2000), firstDate: DateTime(1900), lastDate: DateTime.now()); if (d != null) setState(() => _birth = d); }),
      Text(tr('set.birthVis'), style: TextStyle(color: Theme.of(context).colorScheme.onSurface.withValues(alpha: .6), fontSize: 13)), const SizedBox(height: 6),
      DropdownButtonFormField<String>(value: _bv, items: [for (final v in kVisibilities) DropdownMenuItem(value: v, child: Text(tr('vis.$v')))], onChanged: (v) => setState(() => _bv = v ?? 'me')),
    ]));
}

class RelationsPage extends StatefulWidget {
  const RelationsPage({super.key});
  @override
  State<RelationsPage> createState() => _RelationsState();
}
class _RelationsState extends State<RelationsPage> {
  List<Relation>? _r; Object? _err;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async { try { final r = await Repo.i.relations(); if (mounted) setState(() { _r = r; _err = null; }); } catch (e) { if (mounted) setState(() => _err = e); } }
  Future<void> _act(Future<void> Function() f) async { try { await f(); await _load(); } catch (e) { if (mounted) toast(context, errText(e, tr)); } }
  @override
  Widget build(BuildContext context) {
    final r = _r;
    Widget sec(String t, List<Relation> l, Widget Function(Relation) trail) => l.isEmpty ? const SizedBox.shrink() : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 4), child: Text(t, style: const TextStyle(fontWeight: FontWeight.w800))),
      for (final x in l) ListTile(leading: Avatar(keyPath: x.avatar, name: x.name, size: 42), title: Text(x.name), subtitle: Text('@${x.username} · ${tr('rel.${x.kind}')}'), trailing: trail(x), onTap: () => context.push('/u/${x.username}')),
    ]);
    return Scaffold(appBar: AppBar(title: Text(tr('rel.title'))), body: r == null ? (_err != null ? Empty(tr('error'), onRetry: _load) : const Center(child: CircularProgressIndicator(strokeWidth: 2.5)))
      : r.isEmpty ? Empty(tr('rel.none')) : ListView(children: [
        sec(tr('rel.incoming'), r.where((x) => x.status == 'pending' && x.incoming).toList(), (x) => Row(mainAxisSize: MainAxisSize.min, children: [
          IconButton(onPressed: () => _act(() => Repo.i.approveRelation(x.id)), icon: Icon(Icons.check_circle, color: Theme.of(context).colorScheme.primary)),
          IconButton(onPressed: () => _act(() => Repo.i.removeRelation(x.id)), icon: const Icon(Icons.cancel_outlined))])),
        sec(tr('rel.sent'), r.where((x) => x.status == 'pending' && !x.incoming).toList(), (x) => IconButton(onPressed: () => _act(() => Repo.i.removeRelation(x.id)), icon: const Icon(Icons.close))),
        sec(tr('rel.active'), r.where((x) => x.status == 'approved').toList(), (x) => IconButton(onPressed: () async { if (await confirm(context, '${tr('rel.remove')}?')) _act(() => Repo.i.removeRelation(x.id)); }, icon: const Icon(Icons.link_off))),
      ]));
  }
}

class BlockedPage extends StatefulWidget {
  const BlockedPage({super.key});
  @override
  State<BlockedPage> createState() => _BlockedState();
}
class _BlockedState extends State<BlockedPage> {
  List<UserLite>? _u;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async { try { final u = await Repo.i.blockedUsers(); if (mounted) setState(() => _u = u); } catch (_) { if (mounted) setState(() => _u = []); } }
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(tr('set.blocked'))), body: _u == null ? const Center(child: CircularProgressIndicator(strokeWidth: 2.5))
    : _u!.isEmpty ? Empty(tr('set.noblocked')) : ListView(children: [for (final u in _u!) UserRow(u, trailing: TextButton(onPressed: () async { await Repo.i.block(u.username, false); _load(); }, child: Text(tr('p.unblock'))))]));
}
