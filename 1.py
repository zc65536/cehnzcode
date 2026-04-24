import json
from openai import OpenAI

# --- 请在此处填写你的配置 ---
API_BASE_URL = "https://www.dmxapi.cn/v1"  # 记得加上 /v1
API_KEY = "sk-CyBVeDkK7HEezkp0wfrXuhRXkfnHtmPdcfCVkcSffDgb0vDa"
MODEL = "mimo-v2.5-free"

client = OpenAI(
    api_key=API_KEY,
    base_url=API_BASE_URL
)

def check_usage_support():
    try:
        print(f"正在向 {API_BASE_URL} 发送测试请求...\n")
        
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "user", "content": "你好，请回复'收到'。"}
            ],
            # 即使某些供应商默认不返回，显式设置可能有帮助
            temperature=0.1 
        )

        # 1. 检查是否存在 usage 字段
        if hasattr(response, 'usage') and response.usage is not None:
            usage = response.usage
            print("✅ 恭喜！你的供应商提供了 usage 字段。")
            print("-" * 30)
            print(f"输入 Token (Prompt): {usage.prompt_tokens}")
            print(f"输出 Token (Completion): {usage.completion_tokens}")
            print(f"总计 Token (Total): {usage.total_tokens}")
            
            # 部分供应商（如 DeepSeek）还会提供缓存命中情况
            if hasattr(usage, 'prompt_cache_hit_tokens'):
                print(f"缓存命中 Token: {usage.prompt_cache_hit_tokens}")
        else:
            print("❌ 供应商返回的对象中没有 usage 字段。")
            
        # 2. 打印完整的响应结构以供调试
        print("\n[完整响应结构]：")
        print(json.dumps(response.model_dump(), indent=2, ensure_ascii=False))

    except Exception as e:
        print(f"⚠️ 请求发生错误: {e}")

if __name__ == "__main__":
    check_usage_support()