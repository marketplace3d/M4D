from django import template

register = template.Library()

@register.filter
def get_item(d, key):
    """{{ my_dict|get_item:key }} — safe dict lookup in templates."""
    if isinstance(d, dict):
        return d.get(key, "")
    return ""
