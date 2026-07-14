from typing import Dict


# Shared mutable state. Import this object; never replace it with another dict.
RESTAURANT_LOCATION_CACHE: Dict[str, str] = {}
