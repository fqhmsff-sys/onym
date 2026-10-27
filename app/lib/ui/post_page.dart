import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../core/i18n.dart';
import '../core/util.dart';
import '../data/models.dart';
import '../data/repo.dart';
import 'post_tile.dart';
import 'widgets.dart';

class PostPage extends StatefulWidget {
  final String id; final Post? initial;
  const PostPage(this.id, {super.key, this.initial});
  @override
  State<PostPage> createState() => _PostPageState();
}

class _PostPageState extends State<PostPage> {
  Post? _p; bool _missing = false; List<Comment> _cs = []; bool _loadingC = true;
  final _in = TextEditingController(); final _focus = FocusNode(); Comment? _replyTo; Comment? _editing; bool _sending = false;
  @override
  void initState() { super.initState(); _p = widget.initial; _load(); }
  @override
  void dispose() { _in.dispose(); _focus.dispose(); super.dispose(); }
  Future<void> _load() async {
    try {
      final p = await Repo.i.post(widget.id);
      if (!mounted) return;
      if (p == null) { setState(() => _missing = _p == null); } else { setState(() => _p = p); Repo.i.view(p.id); }
      final c = await Repo.i.comments(widget.id);
      if (mounted) setState(() { _cs = c; _loadingC = false; });
    } catch (_) { if (mounted) setState(() => _loadingC = false); }
  }
  Future<void> _send() async {
    final t = _in.text.trim(); if (t.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      if (_editing != null) { await Repo.i.editComment(_editing!.id, t); }
      else { await Repo.i.addComment(widget.id, t, parentId: _replyTo?.parentId ?? _replyTo?.id); }
      _in.clear(); _replyTo = null; _editing = null;
      final c = await Repo.i.comments(widget.id); final p = await Repo.i.post(widget.id);
      if (mounted) setState(() { _cs = c; if (p != null) _p = p; });
    } catch (e) { if (mounted) toast(context, errText(e, tr)); }
    if (mounted) setState(() => _sending = false);
  }
  Future<void> _like(Comment c) async {
    final i = _cs.indexWhere((x) => x.id == c.id); final n = c.copyWith(liked: !c.liked, likes: c.likes + (c.liked ? -1 : 1));
    setState(() => _cs[i] = n);
    try { await Repo.i.likeComment(c.id, n.liked); } catch (_) { if (mounted) setState(() => _cs[i] = c); }
  }
  Future<void> _menu(Comment c) async {
    final a = await showModalBottomSheet<String>(context: context, builder: (x) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      ListTile(leading: const Icon(Icons.edit_outlined), title: Text(tr('c.edit')), onTap: () => Navigator.pop(x, 'edit')),
      ListTile(leading: const Icon(Icons.delete_outline), title: Text(tr('c.delete')), onTap: () => Navigator.pop(x, 'del')),
    ])));
    if (a == 'edit') { setState(() { _editing = c; _replyTo = null; _in.text = c.body; }); _focus.requestFocus(); }
    if (a == 'del' && await confirm(context, tr('c.delete') + '?')) { await Repo.i.deleteComment(c.id); _load(); }
  }
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme; final p = _p;
    final roots = _cs.where((c) => c.parentId == null).toList();
    Widget row(Comment c, {bool reply = false}) => Padding(padding: EdgeInsets.fromLTRB(reply ? 52 : 14, 8, 8, 4), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      GestureDetector(onTap: () => context.push('/u/${c.authorHandle}'), child: Avatar(keyPath: c.authorAvatar, name: c.authorName, size: reply ? 28 : 34)), const SizedBox(width: 10),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${c.authorName}  ${ago(c.createdAt, tr)}${c.editedAt != null ? ' · ${tr('c.edited')}' : ''}', style: TextStyle(fontSize: 12.5, color: cs.onSurface.withValues(alpha: .6))),
        const SizedBox(height: 2), SelectableText(c.body),
        Row(children: [
          TextButton(style: TextButton.styleFrom(minimumSize: Size.zero, padding: const EdgeInsets.symmetric(horizontal: 0, vertical: 6), tapTargetSize: MaterialTapTargetSize.shrinkWrap),
              onPressed: () { setState(() { _replyTo = c; _editing = null; }); _focus.requestFocus(); }, child: Text(tr('c.reply'), style: const TextStyle(fontSize: 12.5))),
        ]),
      ])),
      Column(children: [
        IconButton(visualDensity: VisualDensity.compact, onPressed: () => _like(c), icon: Icon(c.liked ? Icons.favorite : Icons.favorite_border, size: 18, color: c.liked ? Colors.redAccent : cs.onSurface.withValues(alpha: .5))),
        if (c.likes > 0) Text('${c.likes}', style: const TextStyle(fontSize: 11)),
      ]),
      if (Repo.i.signedIn && c.authorId == Repo.i.uid) IconButton(visualDensity: VisualDensity.compact, onPressed: () => _menu(c), icon: const Icon(Icons.more_vert, size: 18)),
    ]));
    return Scaffold(
      appBar: AppBar(title: Text(tr('c.title'))),
      body: _missing ? Empty(tr('post.notFound')) : Column(children: [
        Expanded(child: ListView(children: [
          if (p != null) PostTile(p, detail: true, onChanged: (n) => _p = n, onDeleted: (_) {}),
          const Divider(height: 1),
          if (_loadingC) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
          else if (_cs.isEmpty) Padding(padding: const EdgeInsets.all(28), child: Center(child: Text(tr('c.empty'), style: TextStyle(color: cs.onSurface.withValues(alpha: .5)))))
          else ...[for (final r in roots) ...[row(r), for (final x in _cs.where((c) => c.parentId == r.id)) row(x, reply: true)]],
          const SizedBox(height: 24),
        ])),
        SafeArea(top: false, child: Container(decoration: BoxDecoration(border: Border(top: BorderSide(color: Theme.of(context).dividerColor))), padding: const EdgeInsets.fromLTRB(12, 8, 8, 8), child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (_replyTo != null || _editing != null) Row(children: [
            Expanded(child: Text(_editing != null ? tr('c.edit') : tr('c.replying', {'n': _replyTo!.authorName}), style: TextStyle(fontSize: 12.5, color: cs.primary))),
            IconButton(visualDensity: VisualDensity.compact, onPressed: () => setState(() { _replyTo = null; _editing = null; _in.clear(); }), icon: const Icon(Icons.close, size: 18)),
          ]),
          Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Expanded(child: TextField(controller: _in, focusNode: _focus, minLines: 1, maxLines: 4, maxLength: 1000, buildCounter: (_, {required currentLength, required isFocused, maxLength}) => null,
                decoration: InputDecoration(hintText: tr('c.hint')))),
            const SizedBox(width: 6),
            IconButton.filled(onPressed: _sending ? null : _send, icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.arrow_upward)),
          ]),
        ]))),
      ]),
    );
  }
}
