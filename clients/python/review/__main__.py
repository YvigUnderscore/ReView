# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

"""``python -m review …`` — the entry point that needs no installation.

A DCC interpreter rarely has the ``review`` console script on its PATH; adding the client
folder to ``PYTHONPATH`` and calling the module always works.
"""

from .cli import main

raise SystemExit(main())
