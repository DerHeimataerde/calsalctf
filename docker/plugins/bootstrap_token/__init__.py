import os
from datetime import datetime, timedelta
from secrets import token_urlsafe

from CTFd.models import db, Users, Tokens
from CTFd.utils.crypto import hash_password
from CTFd.utils import set_config, get_config
from sqlalchemy import text

TOKEN_OUT_PATH = "/data/ctfd_token"

def _pick_valid_token_type():
    # Discover valid polymorphic idents at runtime
    idents = list(Tokens.__mapper__.polymorphic_map.keys())
    # Prefer commonly-used identifiers if present
    for cand in ("api", "permanent", "auth", "token"):
        if cand in idents:
            return cand
    # Fallback to the first available identity
    return idents[0] if idents else None

def _bootstrap(app):
    ADMIN_EMAIL = os.environ.get("BOOTSTRAP_ADMIN_EMAIL", "")
    ADMIN_PASS  = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD", "")
    ADMIN_NAME  = os.environ.get("BOOTSTRAP_ADMIN_NAME", "")

    with app.app_context():
        # 1) ensure admin
        admin = Users.query.filter_by(type="admin").first()
        if not admin:
            admin = Users(
                name=ADMIN_NAME, email=ADMIN_EMAIL,
                password=ADMIN_PASS,
                type="admin", verified=True, hidden=False
            )
            db.session.add(admin); db.session.commit()

        # 2) ensure tokens.type has no NULLs (backfill)
        tok_type = _pick_valid_token_type()
        if tok_type:
            db.session.execute(text("UPDATE tokens SET type=:t WHERE type IS NULL"), {"t": tok_type})
            db.session.commit()

        # 3) ensure an admin token exists with a valid type
        tok = Tokens.query.filter_by(user_id=admin.id).first()
        if tok:
            token_value = tok.value
            # if its type is somehow NULL, fix it
            if getattr(tok, "type", None) in (None, "NULL", "") and tok_type:
                db.session.execute(text("UPDATE tokens SET type=:t WHERE id=:id"), {"t": tok_type, "id": tok.id})
                db.session.commit()
        else:
            token_value = "ctfd_" + token_urlsafe(48)
            new_tok_kwargs = dict(
                user_id=admin.id,
                value=token_value,
                expiration=datetime.utcnow() + timedelta(days=3650),
                description="bootstrap",
            )
            if tok_type:
                new_tok_kwargs["type"] = tok_type
            t = Tokens(**new_tok_kwargs)
            db.session.add(t); db.session.commit()

        os.makedirs(os.path.dirname(TOKEN_OUT_PATH), exist_ok=True)
        with open(TOKEN_OUT_PATH, "w") as f:
            f.write(token_value + "\n")

        # 4) write base config so setup wizard is skipped
        set_config("ctf_name", get_config("ctf_name") or "My Awesome CTF")
        set_config("user_mode", get_config("user_mode") or "users")  # or "teams"
        set_config("registration_visibility", get_config("registration_visibility") or "public")
        set_config("challenge_visibility",   get_config("challenge_visibility")   or "public")
        set_config("score_visibility",       get_config("score_visibility")       or "public")
        if get_config("ctf_active") is None:
            set_config("ctf_active", True)
        # Some versions rely on an explicit "setup" flag:
        if get_config("setup") is None:
            set_config("setup", True)

def load(app):
    try:
        _bootstrap(app)
        print("[bootstrap_token] ensured admin, token (typed), base config")
    except Exception as e:
        print(f"[bootstrap_token] failed: {e}")
