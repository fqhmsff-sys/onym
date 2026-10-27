import '../core/util.dart';

class MediaItem {
  final String kind, key; final int w, h, d;
  const MediaItem({required this.kind, required this.key, this.w = 0, this.h = 0, this.d = 0});
  factory MediaItem.fromJson(Map m) => MediaItem(kind: '${m['kind']}', key: '${m['key']}', w: (m['w'] as num?)?.toInt() ?? 0, h: (m['h'] as num?)?.toInt() ?? 0, d: (m['d'] as num?)?.toInt() ?? 0);
  Map<String, dynamic> toJson() => {'kind': kind, 'key': key, 'w': w, 'h': h, 'd': d};
  bool get isPhoto => kind == 'photo';
  bool get isVideo => kind == 'video';
  bool get isAudio => kind == 'audio';
}

class Post {
  final String id, authorId, authorName, authorHandle, body, visibility, createdAt;
  final String? authorAvatar;
  final List<MediaItem> media;
  final bool inRandom, starred, saved;
  final int stars, comments, views, ratingCount;
  final double? ratingAvg;
  final int? myRating;
  const Post({required this.id, required this.authorId, required this.authorName, required this.authorHandle, this.authorAvatar, required this.body, required this.media,
    required this.visibility, required this.inRandom, required this.createdAt, required this.stars, required this.comments, required this.views,
    this.ratingAvg, required this.ratingCount, required this.starred, required this.saved, this.myRating});
  factory Post.fromRow(Map r) => Post(
    id: '${r['id']}', authorId: '${r['author_id']}', authorName: '${r['author_name']}', authorHandle: '${r['author_handle']}', authorAvatar: r['author_avatar'] as String?,
    body: '${r['body'] ?? ''}', media: [for (final m in (r['media'] as List? ?? const [])) MediaItem.fromJson(m as Map)], visibility: '${r['visibility'] ?? 'public'}',
    inRandom: r['in_random'] == true, createdAt: normTs('${r['created_at']}'), stars: (r['stars'] as num?)?.toInt() ?? 0, comments: (r['comments'] as num?)?.toInt() ?? 0,
    views: (r['views'] as num?)?.toInt() ?? 0, ratingAvg: (r['rating_avg'] as num?)?.toDouble(), ratingCount: (r['rating_count'] as num?)?.toInt() ?? 0,
    starred: r['starred'] == true, saved: r['saved'] == true, myRating: (r['my_rating'] as num?)?.toInt());
  Map<String, dynamic> toRow() => {'id': id, 'author_id': authorId, 'author_name': authorName, 'author_handle': authorHandle, 'author_avatar': authorAvatar, 'body': body,
    'media': [for (final m in media) m.toJson()], 'visibility': visibility, 'in_random': inRandom, 'created_at': createdAt, 'stars': stars, 'comments': comments, 'views': views,
    'rating_avg': ratingAvg, 'rating_count': ratingCount, 'starred': starred, 'saved': saved, 'my_rating': myRating};
  Post copyWith({String? body, String? visibility, bool? inRandom, int? stars, int? comments, bool? starred, bool? saved, double? ratingAvg, int? ratingCount, int? myRating, bool clearRating = false}) => Post(
    id: id, authorId: authorId, authorName: authorName, authorHandle: authorHandle, authorAvatar: authorAvatar, body: body ?? this.body, media: media,
    visibility: visibility ?? this.visibility, inRandom: inRandom ?? this.inRandom, createdAt: createdAt, stars: stars ?? this.stars, comments: comments ?? this.comments, views: views,
    ratingAvg: clearRating ? ratingAvg : (ratingAvg ?? this.ratingAvg), ratingCount: ratingCount ?? this.ratingCount, starred: starred ?? this.starred, saved: saved ?? this.saved,
    myRating: clearRating ? null : (myRating ?? this.myRating));
  String get cursor => '${createdAt}_$id';
}

class Comment {
  final String id, postId, authorId, authorName, authorHandle, body, createdAt;
  final String? parentId, authorAvatar, editedAt;
  final int likes; final bool liked;
  const Comment({required this.id, required this.postId, this.parentId, required this.authorId, required this.authorName, required this.authorHandle, this.authorAvatar,
    required this.body, required this.createdAt, this.editedAt, required this.likes, required this.liked});
  factory Comment.fromRow(Map r) => Comment(id: '${r['id']}', postId: '${r['post_id']}', parentId: r['parent_id'] as String?, authorId: '${r['author_id']}', authorName: '${r['author_name']}',
    authorHandle: '${r['author_handle']}', authorAvatar: r['author_avatar'] as String?, body: '${r['body']}', createdAt: normTs('${r['created_at']}'), editedAt: r['edited_at'] as String?,
    likes: (r['like_count'] as num?)?.toInt() ?? 0, liked: r['liked'] == true);
  Comment copyWith({String? body, int? likes, bool? liked, String? editedAt}) => Comment(id: id, postId: postId, parentId: parentId, authorId: authorId, authorName: authorName,
    authorHandle: authorHandle, authorAvatar: authorAvatar, body: body ?? this.body, createdAt: createdAt, editedAt: editedAt ?? this.editedAt, likes: likes ?? this.likes, liked: liked ?? this.liked);
}

class Profile {
  final String id, username, displayName, createdAt;
  final String? bio, avatar, birthDate, relationKind, relationStatus, relationId;
  final int followers, following, posts; final bool iFollow, followsMe, blocked, isMe;
  const Profile({required this.id, required this.username, required this.displayName, required this.createdAt, this.bio, this.avatar, this.birthDate, this.relationKind, this.relationStatus,
    this.relationId, required this.followers, required this.following, required this.posts, required this.iFollow, required this.followsMe, required this.blocked, required this.isMe});
  factory Profile.fromRow(Map r) => Profile(id: '${r['id']}', username: '${r['username']}', displayName: '${r['display_name']}', createdAt: '${r['created_at']}', bio: r['bio'] as String?,
    avatar: r['avatar'] as String?, birthDate: r['birth_date'] as String?, relationKind: r['relation_kind'] as String?, relationStatus: r['relation_status'] as String?, relationId: r['relation_id'] as String?,
    followers: (r['followers'] as num?)?.toInt() ?? 0, following: (r['following'] as num?)?.toInt() ?? 0, posts: (r['posts'] as num?)?.toInt() ?? 0, iFollow: r['i_follow'] == true,
    followsMe: r['follows_me'] == true, blocked: r['blocked'] == true, isMe: r['is_me'] == true);
}

class UserLite {
  final String id, username, displayName; final String? avatar;
  const UserLite({required this.id, required this.username, required this.displayName, this.avatar});
  factory UserLite.fromRow(Map r) => UserLite(id: '${r['id']}', username: '${r['username']}', displayName: '${r['display_name']}', avatar: r['avatar'] as String?);
}

class Relation {
  final String id, username, name, kind, status; final String? avatar; final bool incoming;
  const Relation({required this.id, required this.username, required this.name, this.avatar, required this.kind, required this.status, required this.incoming});
  factory Relation.fromRow(Map r) => Relation(id: '${r['id']}', username: '${r['other_username']}', name: '${r['other_name']}', avatar: r['other_avatar'] as String?, kind: '${r['kind']}', status: '${r['status']}', incoming: r['incoming'] == true);
}

class Notif {
  final String type, createdAt; final String? postId; final bool read; final UserLite? actor;
  const Notif({required this.type, required this.createdAt, this.postId, required this.read, this.actor});
  factory Notif.fromJson(Map r) => Notif(type: '${r['type']}', createdAt: '${r['created_at']}', postId: r['post_id'] as String?, read: r['read'] == true,
    actor: r['actor'] is Map ? UserLite.fromRow(r['actor'] as Map) : null);
}

class Me {
  final String id, username, displayName;
  const Me(this.id, this.username, this.displayName);
}

class Pg<T> { final List<T> items; final String? next; const Pg(this.items, this.next); }

const kVisibilities = ['public', 'followers', 'following', 'mutual', 'relationship', 'friend', 'bestfriend', 'partner', 'family', 'me'];
const kRelationKinds = ['friend', 'bestfriend', 'partner', 'family'];
